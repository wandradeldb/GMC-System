const express = require('express');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const DB_PATH = require('../db-path');

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// â”€â”€ GET /projects/:pid/payapps  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// List all PayApps for project (history)
router.get('/projects/:pid/payapps', (req, res) => {
  const con  = db();
  const rows = con.prepare('SELECT * FROM payapp WHERE project_id=? ORDER BY app_number').all(req.params.pid);
  const latest = rows[rows.length - 1] || null;
  const contractValue = (con.prepare('SELECT contract_value FROM project WHERE id=?').get(req.params.pid) || {}).contract_value || 0;
  const totalBOQ = (con.prepare('SELECT COALESCE(SUM(qty*rate),0) AS t FROM boq_item WHERE project_id=?').get(req.params.pid) || {}).t || 0;
  con.close();
  res.json({ payapps: rows, latest, summary: { contractValue, totalBOQ } });
});

// â”€â”€ GET /projects/:pid/payapps/:id  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Single PayApp with its items
router.get('/projects/:pid/payapps/:id', (req, res) => {
  const con    = db();
  const payapp = con.prepare('SELECT * FROM payapp WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
  if (!payapp) { con.close(); return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); }
  const items = con.prepare(`
    SELECT pi.*, bi.item_ref, bi.description, bi.schedule, bi.section, bi.unit, bi.type,
           ROUND(bi.qty*bi.rate,2) AS contract_sum
    FROM payapp_item pi
    JOIN boq_item bi ON bi.id = pi.boq_item_id
    WHERE pi.payapp_id = ?
    ORDER BY bi.sort_order, bi.schedule, bi.item_ref
  `).all(payapp.id);
  con.close();
  res.json({ payapp, items });
});

// â”€â”€ GET /projects/:pid/payapps/new/boq-sheet  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns BOQ for new PayApp entry, pre-filling % from the last certified payapp
router.get('/projects/:pid/payapps/new/boq-sheet', (req, res) => {
  const con = db();

  // Last certified PayApp
  const lastCert = con.prepare(`
    SELECT * FROM payapp WHERE project_id=? AND status='certified' ORDER BY app_number DESC LIMIT 1
  `).get(req.params.pid);

  // BOQ items with prev pct from last certified payapp_items
  const items = con.prepare(`
    SELECT bi.id AS boq_item_id, bi.item_ref, bi.description, bi.schedule, bi.section,
           bi.unit, bi.type, bi.rate, bi.qty, ROUND(bi.qty*bi.rate,2) AS contract_sum, bi.sort_order,
           COALESCE(pi.pct_complete, 0) AS pct_prev,
           COALESCE(pi.value_claimed, 0) AS value_prev
    FROM boq_item bi
    LEFT JOIN payapp_item pi ON pi.boq_item_id = bi.id AND pi.payapp_id = ?
    WHERE bi.project_id = ?
    ORDER BY bi.sort_order, bi.schedule
  `).all(lastCert?.id || -1, req.params.pid);

  const nextAppNumber = (con.prepare('SELECT COALESCE(MAX(app_number),0)+1 AS n FROM payapp WHERE project_id=?').get(req.params.pid) || {}).n || 1;

  // Historical % per item per app
  const allApps = con.prepare('SELECT id, app_number, period FROM payapp WHERE project_id=? ORDER BY app_number').all(req.params.pid);
  const histRows = con.prepare(`
    SELECT pi.boq_item_id, pa.app_number, pi.pct_complete
    FROM payapp_item pi
    JOIN payapp pa ON pa.id = pi.payapp_id
    WHERE pa.project_id = ?
  `).all(req.params.pid);
  const history = {};
  for (const r of histRows) {
    if (!history[r.boq_item_id]) history[r.boq_item_id] = {};
    history[r.boq_item_id][r.app_number] = r.pct_complete;
  }

  con.close();
  res.json({
    next_app_number: nextAppNumber,
    last_certified:  lastCert || null,
    previously_certified: lastCert ? lastCert.net_cumulative : 0,
    items,
    history,
    prior_apps: allApps,
  });
});

// â”€â”€ POST /projects/:pid/payapps  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Create (or update draft) a new PayApp
router.post('/projects/:pid/payapps', (req, res) => {
  const con = db();
  con.exec('BEGIN');
  try {
    const pid = req.params.pid;
    const { app_number, period, date_submitted, retention_pct = 3.0,
            ae_cumulative = 0, prepared_by, notes, items = [],
            works_gross_override } = req.body;

    // Compute totals â€” use manual override if provided, else sum from items
    const works_gross_cum  = works_gross_override != null
      ? round2(parseFloat(works_gross_override))
      : round2(items.reduce((s, i) => s + ((parseFloat(i.pct_complete) || 0) / 100) * (i.contract_sum || 0), 0));
    const total_gross_cum  = round2(works_gross_cum + (parseFloat(ae_cumulative) || 0));
    const ret_pct          = parseFloat(retention_pct) || 3.0;
    const retention_cum    = round2(total_gross_cum * ret_pct / 100);
    const net_cumulative   = round2(total_gross_cum - retention_cum);

    // Previously certified = net_cumulative of last certified payapp
    const lastCert = con.prepare(`SELECT net_cumulative FROM payapp WHERE project_id=? AND status='certified' ORDER BY app_number DESC LIMIT 1`).get(pid);
    const previously_certified = lastCert ? round2(lastCert.net_cumulative) : 0;
    const this_certificate = round2(net_cumulative - previously_certified);

    // Upsert payapp
    const existing = con.prepare('SELECT id FROM payapp WHERE project_id=? AND app_number=?').get(pid, app_number);
    let payappId;

    if (existing) {
      payappId = existing.id;
      con.prepare(`
        UPDATE payapp SET period=?, date_submitted=?, retention_pct=?,
          works_gross_cumulative=?, ae_cumulative=?, total_gross_cumulative=?,
          retention_cumulative=?, net_cumulative=?, previously_certified=?,
          this_certificate=?, prepared_by=?, notes=?, source='manual'
        WHERE id=?
      `).run(period, date_submitted, ret_pct, works_gross_cum, ae_cumulative,
             total_gross_cum, retention_cum, net_cumulative, previously_certified,
             this_certificate, prepared_by || null, notes || null, payappId);
    } else {
      con.prepare(`
        INSERT INTO payapp (project_id, app_number, period, date_submitted, status, retention_pct,
          works_gross_cumulative, ae_cumulative, total_gross_cumulative,
          retention_cumulative, net_cumulative, previously_certified, this_certificate,
          prepared_by, notes, source)
        VALUES (?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,'manual')
      `).run(pid, app_number, period, date_submitted, ret_pct, works_gross_cum, ae_cumulative,
             total_gross_cum, retention_cum, net_cumulative, previously_certified,
             this_certificate, prepared_by || null, notes || null);
      payappId = con.prepare('SELECT id FROM payapp WHERE project_id=? AND app_number=?').get(pid, app_number).id;
    }

    // Upsert items
    const insItem = con.prepare(`
      INSERT INTO payapp_item (payapp_id, boq_item_id, pct_complete, value_claimed, notes)
      VALUES (?,?,?,?,?)
      ON CONFLICT(payapp_id, boq_item_id) DO UPDATE SET
        pct_complete=excluded.pct_complete, value_claimed=excluded.value_claimed, notes=excluded.notes
    `);
    for (const item of items) {
      if (!item.boq_item_id) continue;
      const pct = Math.min(100, Math.max(0, parseFloat(item.pct_complete) || 0));
      const val = round2((pct / 100) * (item.contract_sum || 0));
      insItem.run(payappId, item.boq_item_id, pct, val, item.notes || null);
    }

    con.exec('COMMIT');
    const saved = con.prepare('SELECT * FROM payapp WHERE id=?').get(payappId);
    con.close();
    res.json({ ok: true, payapp: saved });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// â”€â”€ PATCH /projects/:pid/payapps/:id/status  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Submit / certify / mark paid
router.patch('/projects/:pid/payapps/:id/status', (req, res) => {
  const con = db();
  const { status, date_certified, cert_number, er_works_certified, er_net_certified, er_this_cert } = req.body;
  const ALLOWED = ['draft','submitted','certified','paid'];
  if (!ALLOWED.includes(status)) {
    con.close(); return res.status(400).json({ error: 'Invalid status', code: 'INVALID_STATUS' });
  }
  con.prepare(`
    UPDATE payapp SET status=?,
      date_certified=COALESCE(?,date_certified),
      cert_number=COALESCE(?,cert_number),
      er_works_certified=COALESCE(?,er_works_certified),
      er_net_certified=COALESCE(?,er_net_certified),
      er_this_cert=COALESCE(?,er_this_cert)
    WHERE id=? AND project_id=?
  `).run(status, date_certified||null, cert_number||null,
         er_works_certified||null, er_net_certified||null, er_this_cert||null,
         req.params.id, req.params.pid);
  const saved = con.prepare('SELECT * FROM payapp WHERE id=?').get(req.params.id);
  con.close();
  res.json({ ok: true, payapp: saved });
});

// Error handler
router.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message, code: 'ERROR' });
});

module.exports = router;
