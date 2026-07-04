const express = require('express');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const DB_PATH = require('../db-path');

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  return con;
}

// GET /api/v1/projects — projects owned by or shared with the authenticated user
router.get('/projects', (req, res) => {
  const con = db();
  const rows = con.prepare(`
    SELECT DISTINCT p.id, p.ref, p.name, p.client, p.contract_value, p.status, p.start_date, p.end_date,
      CASE WHEN p.owner_id = ? THEN 'owner' ELSE pm.role END AS access_role
    FROM project p
    LEFT JOIN project_member pm ON pm.project_id = p.id AND pm.user_id = ?
    WHERE p.owner_id = ? OR pm.user_id = ?
    ORDER BY p.id
  `).all(req.user.id, req.user.id, req.user.id, req.user.id);
  con.close();
  // Site team (field-only members) never see financial figures, not even on the project card
  const safeRows = rows.map(r => r.access_role === 'site' ? { ...r, contract_value: null } : r);
  res.json(safeRows);
});

// POST /api/v1/projects — create a new project owned by the authenticated user
router.post('/projects', (req, res) => {
  const { name, ref, client, contract_value, start_date, end_date } = req.body || {};
  if (!name || !ref) return res.status(400).json({ error: 'name and ref are required', code: 'MISSING_FIELDS' });
  const con = db();
  const result = con.prepare(`
    INSERT INTO project (name, ref, client, contract_value, status, start_date, end_date, owner_id)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(name, ref, client || '', contract_value || 0, start_date || null, end_date || null, req.user.id);
  const project = con.prepare('SELECT id, ref, name, client, contract_value, status, start_date, end_date FROM project WHERE id = ?').get(result.lastInsertRowid);
  con.close();
  res.status(201).json(project);
});

// GET /api/v1/projects/:id
router.get('/projects/:id', (req, res) => {
  const con = db();
  const project = con.prepare(`
    SELECT id, ref, name, client, contract_value, status, start_date, end_date
    FROM project WHERE id = ?
  `).get(req.params.id);
  con.close();
  if (!project) return res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' });
  if (req.projectRole === 'site') project.contract_value = null;
  res.json(project);
});

// PUT /api/v1/projects/:id  — owner only
router.put('/projects/:id', (req, res) => {
  if (req.projectRole !== 'owner') {
    return res.status(403).json({ error: 'Only the project owner can edit settings', code: 'FORBIDDEN' });
  }
  const { name, ref, client, contract_value, start_date, end_date, status } = req.body || {};
  if (!name?.trim() || !ref?.trim()) {
    return res.status(400).json({ error: 'Name and Reference are required', code: 'MISSING_FIELDS' });
  }
  const validStatuses = ['active', 'closed', 'on_hold', 'completed'];
  const safeStatus = validStatuses.includes(status) ? status : 'active';
  const con = db();
  con.prepare(`
    UPDATE project SET name=?, ref=?, client=?, contract_value=?, start_date=?, end_date=?, status=?
    WHERE id=?
  `).run(
    name.trim(), ref.trim(), client?.trim() || null,
    parseFloat(contract_value) || 0,
    start_date || null, end_date || null,
    safeStatus, req.params.id
  );
  con.close();
  res.json({ ok: true });
});

// POST /api/v1/projects/:id/duplicate — owner only
router.post('/projects/:id/duplicate', (req, res) => {
  if (req.projectRole !== 'owner') {
    return res.status(403).json({ error: 'Only the project owner can duplicate', code: 'FORBIDDEN' });
  }
  const con = db();
  try {
    const source = con.prepare('SELECT * FROM project WHERE id = ?').get(req.params.id);
    if (!source) return res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' });

    function copyRows(table, filterCol, filterVal, newVal, fkRemaps) {
      const colInfo = con.prepare(`PRAGMA table_info(${table})`).all();
      const insertCols = colInfo.map(c => c.name).filter(c => c !== 'id');
      const rows = con.prepare(`SELECT * FROM ${table} WHERE ${filterCol} = ?`).all(filterVal);
      const idMap = {};
      for (const row of rows) {
        const vals = insertCols.map(c => {
          if (c === filterCol) return newVal;
          if (fkRemaps && fkRemaps[c] && fkRemaps[c][row[c]] != null) return fkRemaps[c][row[c]];
          return row[c];
        });
        const sql = `INSERT INTO ${table} (${insertCols.join(',')}) VALUES (${insertCols.map(() => '?').join(',')})`;
        const r = con.prepare(sql).run(...vals);
        idMap[row.id] = r.lastInsertRowid;
      }
      return idMap;
    }

    const SOURCE_ID = source.id;
    const newName = `${source.name} (copy)`;
    const newRef  = `${source.ref} (copy)`;
    const p = con.prepare(`INSERT INTO project (ref,name,client,contract_value,status,start_date,end_date,owner_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(newRef, newName, source.client, source.contract_value,
      source.status, source.start_date, source.end_date, req.user.id);
    const newPid = p.lastInsertRowid;

    const boqIdMap = copyRows('boq_item', 'project_id', SOURCE_ID, newPid, null);
    const subIdMap = copyRows('subcontract', 'project_id', SOURCE_ID, newPid, null);
    for (const [oldSubId, newSubId] of Object.entries(subIdMap)) {
      const sbMap = copyRows('sub_boq_item', 'subcontract_id', oldSubId, newSubId, { boq_item_id: boqIdMap });
      const saMap = copyRows('sub_application', 'subcontract_id', oldSubId, newSubId, null);
      for (const [oldSaId, newSaId] of Object.entries(saMap)) {
        copyRows('sub_application_item', 'sub_application_id', oldSaId, newSaId, { sub_boq_item_id: sbMap });
        copyRows('compensation_event', 'sub_application_id', oldSaId, newSaId, { subcontract_id: subIdMap });
        copyRows('sub_invoice', 'sub_application_id', oldSaId, newSaId, null);
      }
    }
    copyRows('tracker_we', 'project_id', SOURCE_ID, newPid, null);
    copyRows('tracker_sub_revenue', 'project_id', SOURCE_ID, newPid, null);
    const paIdMap = copyRows('payapp', 'project_id', SOURCE_ID, newPid, null);
    for (const [oldPaId, newPaId] of Object.entries(paIdMap))
      copyRows('payapp_item', 'payapp_id', oldPaId, newPaId, { boq_item_id: boqIdMap });
    copyRows('payment_run', 'project_id', SOURCE_ID, newPid, null);
    const deIdMap = copyRows('das_entry', 'project_id', SOURCE_ID, newPid, null);
    for (const [oldDeId, newDeId] of Object.entries(deIdMap)) {
      copyRows('das_labour', 'das_entry_id', oldDeId, newDeId, null);
      copyRows('das_plant', 'das_entry_id', oldDeId, newDeId, null);
      copyRows('das_activity', 'das_entry_id', oldDeId, newDeId, { boq_item_id: boqIdMap });
    }
    copyRows('das_next_week', 'project_id', SOURCE_ID, newPid, null);
    const actIdMap = copyRows('revenue_activity', 'project_id', SOURCE_ID, newPid, null);
    copyRows('revenue_week', 'project_id', SOURCE_ID, newPid, { activity_id: actIdMap, sub_id: subIdMap });
    copyRows('qs_cost_transaction', 'project_id', SOURCE_ID, newPid, null);
    copyRows('excel_sub_cost', 'project_id', SOURCE_ID, newPid, null);
    copyRows('boq_progress', 'project_id', SOURCE_ID, newPid, { boq_item_id: boqIdMap });
    copyRows('sub_assessment', 'project_id', SOURCE_ID, newPid, null);

    const newProject = con.prepare(`
      SELECT id, ref, name, client, contract_value, status, start_date, end_date FROM project WHERE id = ?
    `).get(newPid);
    con.close();
    res.status(201).json(newProject);
  } catch (err) {
    try { con.close(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/projects/:id/boq
// Query params: ?schedule=1  ?group=schedule
router.get('/projects/:id/boq', (req, res) => {
  const con = db();

  const project = con.prepare('SELECT id FROM project WHERE id = ?').get(req.params.id);
  if (!project) {
    con.close();
    return res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' });
  }

  let where  = 'project_id = ?';
  const args = [req.params.id];

  if (req.query.schedule) {
    where += ' AND schedule = ?';
    args.push(req.query.schedule);
  }

  const items = con.prepare(`
    SELECT
      id, schedule, section, item_ref, description,
      unit, qty, rate,
      ROUND(qty * rate, 2) AS contract_sum,
      type, iw_cost_code, sort_order
    FROM boq_item
    WHERE ${where}
    ORDER BY sort_order, schedule, item_ref
  `).all(...args);

  const summary = con.prepare(`
    SELECT schedule, type,
      COUNT(*)                  AS item_count,
      ROUND(SUM(qty * rate), 2) AS subtotal
    FROM boq_item
    WHERE ${where}
    GROUP BY schedule, type
    ORDER BY schedule, type
  `).all(...args);

  const totals = con.prepare(`
    SELECT COUNT(*) AS item_count, ROUND(SUM(qty * rate), 2) AS grand_total
    FROM boq_item WHERE ${where}
  `).get(...args);

  con.close();

  if (req.query.group === 'schedule') {
    const grouped = {};
    for (const item of items) {
      const sch = item.schedule;
      const sec = item.section || 'General';
      if (!grouped[sch])      grouped[sch] = {};
      if (!grouped[sch][sec]) grouped[sch][sec] = [];
      grouped[sch][sec].push(item);
    }
    return res.json({ grouped, summary, totals });
  }

  res.json({ items, summary, totals });
});

module.exports = router;
