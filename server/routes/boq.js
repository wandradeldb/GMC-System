const express = require('express');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const DB_PATH = require('../db-path');

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  return con;
}

// GET /api/v1/projects — only projects owned by the authenticated user
router.get('/projects', (req, res) => {
  const con = db();
  const rows = con.prepare(`
    SELECT id, ref, name, client, contract_value, status, start_date, end_date
    FROM project WHERE owner_id = ? ORDER BY id
  `).all(req.user.id);
  con.close();
  res.json(rows);
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
  res.json(project);
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
