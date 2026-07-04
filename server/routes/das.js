const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const DB_PATH = require('../db-path');
const SITE_AGENTS_SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/site-agents.json'), 'utf8'));

const ACTIVITY_CODES = { A:'Civil', B:'Mechanical', C:'Electrical', D:'Instrumentation', E:'Commissioning', F:'Preliminaries', G:'Other' };
const SERVICE_CATS   = ['Pump Station','Manhole','Pipework','Preliminaries','MEICA','Landscape','Other'];
const WORK_TYPES     = ['Contract','Daywork'];
const WEATHER_OPTS   = ['Fine','Overcast','Light Rain','Heavy Rain','Wind','Frost','Snow'];
const STATUSES       = ['draft','submitted'];

function db(readonly = false) {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  // Self-healing migration (no automated runner in this app — see db/migrations/013_das_subcontractor.sql)
  try {
    con.exec(`CREATE TABLE IF NOT EXISTS das_subcontractor (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      das_entry_id    INTEGER NOT NULL REFERENCES das_entry(id) ON DELETE CASCADE,
      subcontract_id  INTEGER REFERENCES subcontract(id) ON DELETE SET NULL,
      sub_name        TEXT    NOT NULL,
      workers_count   INTEGER NOT NULL DEFAULT 0,
      hours_worked    REAL    NOT NULL DEFAULT 0,
      activity_code   TEXT    CHECK (activity_code IN ('A','B','C','D','E','F','G')),
      work_type       TEXT    NOT NULL DEFAULT 'Contract' CHECK (work_type IN ('Contract', 'Daywork')),
      description     TEXT,
      notes           TEXT,
      sort_order      INTEGER NOT NULL DEFAULT 0
    )`);
  } catch {}
  // Site Agent registry (code, name, phone, email) — company-wide, not per-project
  try {
    con.exec(`CREATE TABLE IF NOT EXISTS site_agent (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      code  TEXT UNIQUE,
      name  TEXT NOT NULL,
      phone TEXT,
      email TEXT
    )`);
    const { n } = con.prepare('SELECT COUNT(*) AS n FROM site_agent').get();
    if (n === 0) {
      const ins = con.prepare('INSERT OR IGNORE INTO site_agent (code, name, phone, email) VALUES (?,?,?,?)');
      con.exec('BEGIN');
      SITE_AGENTS_SEED.forEach(a => ins.run(a.code, a.name, a.phone || null, a.email || null));
      con.exec('COMMIT');
    }
  } catch {}
  try { con.exec('ALTER TABLE das_entry ADD COLUMN site_agent_code TEXT'); } catch {}
  return con;
}

function assertProject(con, projectId) {
  const p = con.prepare('SELECT id FROM project WHERE id = ?').get(projectId);
  if (!p) throw Object.assign(new Error('Project not found'), { status: 404, code: 'NOT_FOUND' });
}

function assertEntry(con, entryId) {
  const e = con.prepare('SELECT id FROM das_entry WHERE id = ?').get(entryId);
  if (!e) throw Object.assign(new Error('DAS entry not found'), { status: 404, code: 'NOT_FOUND' });
}

// â”€â”€ Metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/das/meta', (_req, res) => {
  res.json({ activity_codes: ACTIVITY_CODES, service_categories: SERVICE_CATS, work_types: WORK_TYPES, weather: WEATHER_OPTS });
});

// GET /das/site-agents — registered list (code, name, phone, email), company-wide
router.get('/das/site-agents', (_req, res) => {
  const con = db();
  const rows = con.prepare('SELECT code, name, phone, email FROM site_agent ORDER BY name COLLATE NOCASE').all();
  con.close();
  res.json(rows);
});

// â”€â”€ DAS_ENTRY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /projects/:id/das  â€“ list entries (summary)
router.get('/projects/:id/das', (req, res) => {
  const con = db();
  assertProject(con, req.params.id);
  const entries = con.prepare(`
    SELECT e.id, e.entry_date, e.site_agent, e.weather, e.work_type, e.status,
           COUNT(DISTINCT l.id) AS labour_count,
           COUNT(DISTINCT p.id) AS plant_count,
           COUNT(DISTINCT a.id) AS activity_count
    FROM das_entry e
    LEFT JOIN das_labour   l ON l.das_entry_id = e.id
    LEFT JOIN das_plant    p ON p.das_entry_id = e.id
    LEFT JOIN das_activity a ON a.das_entry_id = e.id
    WHERE e.project_id = ?
    GROUP BY e.id
    ORDER BY e.entry_date DESC
  `).all(req.params.id);
  con.close();
  res.json(entries);
});

// GET /projects/:id/das/suggestions â€“ historical values for autocomplete (workers, plant, activities)
// Reduces re-typing for the field team: names/plant/descriptions used before show up as suggestions.
router.get('/projects/:id/das/suggestions', (req, res) => {
  const con = db();
  assertProject(con, req.params.id);

  const labourRows = con.prepare(`
    SELECT dl.worker_name, dl.trade
    FROM das_labour dl JOIN das_entry de ON de.id = dl.das_entry_id
    WHERE de.project_id = ? AND dl.worker_name != ''
    ORDER BY de.entry_date DESC
  `).all(req.params.id);

  const plantRows = con.prepare(`
    SELECT dp.plant_ref, dp.description, dp.operator
    FROM das_plant dp JOIN das_entry de ON de.id = dp.das_entry_id
    WHERE de.project_id = ?
    ORDER BY de.entry_date DESC
  `).all(req.params.id);

  const activityRows = con.prepare(`
    SELECT da.description, da.unit, da.service_category
    FROM das_activity da JOIN das_entry de ON de.id = da.das_entry_id
    WHERE de.project_id = ? AND da.description != ''
    ORDER BY de.entry_date DESC
  `).all(req.params.id);

  const siteAgentRows = con.prepare(`
    SELECT DISTINCT site_agent FROM das_entry WHERE project_id=? AND site_agent != '' ORDER BY entry_date DESC
  `).all(req.params.id);

  con.close();

  // Dedup keeping the first (most recent, since rows are ordered DESC) occurrence per key
  const dedupBy = (rows, key) => {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const k = (r[key] || '').trim();
      if (!k || seen.has(k.toLowerCase())) continue;
      seen.add(k.toLowerCase());
      out.push(r);
    }
    return out;
  };
  const uniqStrings = arr => [...new Set(arr.map(v => (v || '').trim()).filter(Boolean))];

  res.json({
    workers:          dedupBy(labourRows, 'worker_name').map(r => ({ name: r.worker_name, trade: r.trade })),
    plant:            dedupBy(plantRows.filter(r => r.plant_ref), 'plant_ref')
                        .map(r => ({ ref: r.plant_ref, description: r.description, operator: r.operator })),
    plantDescriptions: uniqStrings(plantRows.map(r => r.description)),
    operators:        uniqStrings(plantRows.map(r => r.operator)),
    activities:       dedupBy(activityRows, 'description').map(r => ({ description: r.description, unit: r.unit, service_category: r.service_category })),
    units:            uniqStrings(activityRows.map(r => r.unit)),
    siteAgents:       siteAgentRows.map(r => r.site_agent),
  });
});

// GET /projects/:id/das/:date  â€“ get or create entry for a date
router.get('/projects/:id/das/:date', (req, res) => {
  const con = db();
  assertProject(con, req.params.id);

  let entry = con.prepare('SELECT * FROM das_entry WHERE project_id=? AND entry_date=?')
                 .get(req.params.id, req.params.date);

  if (!entry) {
    // Auto-create draft
    const r = con.prepare(`
      INSERT INTO das_entry (project_id, entry_date, site_agent, status)
      VALUES (?,?,?,?)
    `).run(req.params.id, req.params.date, '', 'draft');
    entry = con.prepare('SELECT * FROM das_entry WHERE id=?').get(r.lastInsertRowid);
  }

  const labour        = con.prepare('SELECT * FROM das_labour        WHERE das_entry_id=? ORDER BY sort_order').all(entry.id);
  const plant         = con.prepare('SELECT * FROM das_plant         WHERE das_entry_id=? ORDER BY sort_order').all(entry.id);
  const activities    = con.prepare('SELECT * FROM das_activity      WHERE das_entry_id=? ORDER BY activity_code, sort_order').all(entry.id);
  const subcontractors = con.prepare('SELECT * FROM das_subcontractor WHERE das_entry_id=? ORDER BY sort_order').all(entry.id);

  con.close();
  res.json({ entry, labour, plant, activities, subcontractors });
});

// PUT /projects/:id/das/:date  â€“ upsert full DAS (header + children)
router.put('/projects/:id/das/:date', (req, res) => {
  const con = db();
  try {
    assertProject(con, req.params.id);

    const { entry: hdr = {}, labour = [], plant = [], activities = [], subcontractors = [] } = req.body;

    // Upsert header
    con.exec('BEGIN');
    const existing = con.prepare('SELECT id FROM das_entry WHERE project_id=? AND entry_date=?')
                        .get(req.params.id, req.params.date);

    let entryId;
    if (existing) {
      con.prepare(`
        UPDATE das_entry SET site_agent=?, site_agent_code=?, weather=?, work_type=?, visitors=?, general_notes=?, status=?, photo_url=?
        WHERE id=?
      `).run(hdr.site_agent||'', hdr.site_agent_code||null, hdr.weather||null, hdr.work_type||'Contract',
             hdr.visitors||null, hdr.general_notes||null, hdr.status||'draft',
             hdr.photo_url||null, existing.id);
      entryId = existing.id;
    } else {
      const r = con.prepare(`
        INSERT INTO das_entry (project_id, entry_date, site_agent, site_agent_code, weather, work_type, visitors, general_notes, status, photo_url)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(req.params.id, req.params.date, hdr.site_agent||'', hdr.site_agent_code||null, hdr.weather||null,
             hdr.work_type||'Contract', hdr.visitors||null, hdr.general_notes||null, hdr.status||'draft',
             hdr.photo_url||null);
      entryId = r.lastInsertRowid;
    }

    // Replace children
    con.prepare('DELETE FROM das_labour        WHERE das_entry_id=?').run(entryId);
    con.prepare('DELETE FROM das_plant         WHERE das_entry_id=?').run(entryId);
    con.prepare('DELETE FROM das_activity      WHERE das_entry_id=?').run(entryId);
    con.prepare('DELETE FROM das_subcontractor WHERE das_entry_id=?').run(entryId);

    const insLabour = con.prepare(`
      INSERT INTO das_labour (das_entry_id,worker_name,trade,hours_worked,overtime_hours,activity_code,work_type,notes,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    labour.forEach((l, i) => insLabour.run(entryId, l.worker_name, l.trade, l.hours_worked||0,
      l.overtime_hours||0, l.activity_code||null, l.work_type||'Contract', l.notes||null, i*10));

    const insPlant = con.prepare(`
      INSERT INTO das_plant (das_entry_id,plant_ref,description,operator,hours_worked,hours_idle,activity_code,work_type,notes,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    plant.forEach((p, i) => insPlant.run(entryId, p.plant_ref||null, p.description, p.operator||null,
      p.hours_worked||0, p.hours_idle||0, p.activity_code||null, p.work_type||'Contract', p.notes||null, i*10));

    const insActivity = con.prepare(`
      INSERT INTO das_activity (das_entry_id,activity_code,service_category,boq_item_id,description,qty_today,unit,work_type,notes,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    activities.forEach((a, i) => insActivity.run(entryId, a.activity_code, a.service_category,
      a.boq_item_id||null, a.description, a.qty_today||null, a.unit||null,
      a.work_type||'Contract', a.notes||null, i*10));

    const insSub = con.prepare(`
      INSERT INTO das_subcontractor (das_entry_id,subcontract_id,sub_name,workers_count,hours_worked,activity_code,work_type,description,notes,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    subcontractors.forEach((s, i) => insSub.run(entryId, s.subcontract_id||null, s.sub_name,
      s.workers_count||0, s.hours_worked||0, s.activity_code||null, s.work_type||'Contract',
      s.description||null, s.notes||null, i*10));

    if (hdr.status === 'submitted') {
      con.prepare("UPDATE das_entry SET submitted_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").run(entryId);
    }

    con.exec('COMMIT');
    const saved = con.prepare('SELECT * FROM das_entry WHERE id=?').get(entryId);
    con.close();
    res.json({ ok: true, entry: saved });
  } catch (err) {
    con.exec('ROLLBACK');
    con.close();
    throw err;
  }
});

// â”€â”€ DAS_NEXT_WEEK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /projects/:id/next-week/:monday
router.get('/projects/:id/next-week/:monday', (req, res) => {
  const con = db();
  assertProject(con, req.params.id);
  let nw = con.prepare('SELECT * FROM das_next_week WHERE project_id=? AND week_commencing=?')
              .get(req.params.id, req.params.monday);
  if (!nw) {
    const r = con.prepare(`
      INSERT INTO das_next_week (project_id, week_commencing, site_agent) VALUES (?,?,?)
    `).run(req.params.id, req.params.monday, '');
    nw = con.prepare('SELECT * FROM das_next_week WHERE id=?').get(r.lastInsertRowid);
  }
  con.close();
  res.json(nw);
});

// PUT /projects/:id/next-week/:monday
router.put('/projects/:id/next-week/:monday', (req, res) => {
  const con = db();
  assertProject(con, req.params.id);
  const { site_agent='', planned_labour='', planned_plant='', planned_activities='' } = req.body;
  const existing = con.prepare('SELECT id FROM das_next_week WHERE project_id=? AND week_commencing=?')
                      .get(req.params.id, req.params.monday);
  if (existing) {
    con.prepare(`UPDATE das_next_week SET site_agent=?,planned_labour=?,planned_plant=?,planned_activities=? WHERE id=?`)
       .run(site_agent, planned_labour, planned_plant, planned_activities, existing.id);
  } else {
    con.prepare(`INSERT INTO das_next_week (project_id,week_commencing,site_agent,planned_labour,planned_plant,planned_activities) VALUES (?,?,?,?,?,?)`)
       .run(req.params.id, req.params.monday, site_agent, planned_labour, planned_plant, planned_activities);
  }
  const saved = con.prepare('SELECT * FROM das_next_week WHERE project_id=? AND week_commencing=?')
                   .get(req.params.id, req.params.monday);
  con.close();
  res.json({ ok: true, next_week: saved });
});

// â”€â”€ Error handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message, code: err.code || 'ERROR' });
});

module.exports = router;
