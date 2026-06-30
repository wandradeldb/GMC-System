const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');
const DB_PATH  = require('../db-path');

const router  = express.Router();
const SECRET  = process.env.JWT_SECRET || 'gmc-dev-secret-change-in-prod';
const EXPIRES = '8h';

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  // Apply role migration if column missing
  try { con.exec("ALTER TABLE user ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch {}
  try { con.exec("UPDATE user SET role = 'admin' WHERE username = 'admin' AND role IN ('viewer','user')"); } catch {}
  // Rename system role viewer → user
  try { con.exec("UPDATE user SET role = 'user' WHERE role = 'viewer'"); } catch {}
  // Apply project owner migration if column missing
  try { con.exec('ALTER TABLE project ADD COLUMN owner_id INTEGER REFERENCES user(id)'); } catch {}
  try { con.exec('UPDATE project SET owner_id = 1 WHERE owner_id IS NULL'); } catch {}
  // Profile fields
  try { con.exec("ALTER TABLE user ADD COLUMN full_name TEXT"); } catch {}
  try { con.exec("ALTER TABLE user ADD COLUMN email TEXT"); } catch {}
  try { con.exec("ALTER TABLE user ADD COLUMN phone TEXT"); } catch {}
  // Project members table
  try { con.exec(`CREATE TABLE IF NOT EXISTS project_member (
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES user(id)    ON DELETE CASCADE,
    role       TEXT    NOT NULL DEFAULT 'viewer',
    PRIMARY KEY (project_id, user_id)
  )`); } catch {}
  return con;
}

// POST /api/v1/auth/login
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required', code: 'MISSING_FIELDS' });

  const con  = db();
  const user = con.prepare('SELECT * FROM user WHERE username = ?').get(username);
  con.close();

  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'user' },
    SECRET,
    { expiresIn: EXPIRES }
  );
  res.json({ token, username: user.username, role: user.role || 'user' });
});

// GET /api/v1/auth/users
router.get('/auth/users', requireAuth, requireAdmin, (req, res) => {
  const con   = db();
  const users = con.prepare('SELECT id, username, role, created_at FROM user ORDER BY created_at').all();
  con.close();
  res.json(users);
});

// POST /api/v1/auth/users
router.post('/auth/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role = 'user' } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required', code: 'MISSING_FIELDS' });
  if (!['admin', 'user'].includes(role))
    return res.status(400).json({ error: 'Invalid role', code: 'INVALID_ROLE' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const con = db();
    con.prepare('INSERT INTO user (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);
    con.close();
    res.status(201).json({ username, role });
  } catch {
    res.status(409).json({ error: 'Username already exists', code: 'DUPLICATE_USER' });
  }
});

// PUT /api/v1/auth/users/:id/password
router.put('/auth/users/:id/password', requireAuth, requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required', code: 'MISSING_FIELDS' });
  const hash = bcrypt.hashSync(password, 10);
  const con  = db();
  con.prepare('UPDATE user SET password = ? WHERE id = ?').run(hash, req.params.id);
  con.close();
  res.json({ ok: true });
});

// GET /api/v1/auth/me — fetch own profile
router.get('/auth/me', requireAuth, (req, res) => {
  const con  = db();
  const user = con.prepare('SELECT id, username, role, full_name, email, phone, created_at FROM user WHERE id = ?').get(req.user.id);
  con.close();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// PUT /api/v1/auth/me — update own profile info
router.put('/auth/me', requireAuth, (req, res) => {
  const { full_name = '', email = '', phone = '' } = req.body || {};
  const con = db();
  con.prepare('UPDATE user SET full_name = ?, email = ?, phone = ? WHERE id = ?')
     .run(full_name.trim(), email.trim(), phone.trim(), req.user.id);
  con.close();
  res.json({ ok: true });
});

// PUT /api/v1/auth/me/password  — any logged-in user changes their own password
router.put('/auth/me/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'current_password and new_password required', code: 'MISSING_FIELDS' });
  if (new_password.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters', code: 'TOO_SHORT' });

  const con  = db();
  const user = con.prepare('SELECT id, password FROM user WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(current_password, user.password)) {
    con.close();
    return res.status(401).json({ error: 'Current password is incorrect', code: 'INVALID_CREDENTIALS' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  con.prepare('UPDATE user SET password = ? WHERE id = ?').run(hash, req.user.id);
  con.close();
  res.json({ ok: true });
});

// DELETE /api/v1/auth/users/:id
router.delete('/auth/users/:id', requireAuth, requireAdmin, (req, res) => {
  const con  = db();
  const user = con.prepare('SELECT username FROM user WHERE id = ?').get(req.params.id);
  if (user?.username === 'admin') {
    con.close();
    return res.status(403).json({ error: 'Cannot delete admin', code: 'FORBIDDEN' });
  }
  con.prepare('DELETE FROM user WHERE id = ?').run(req.params.id);
  con.close();
  res.json({ ok: true });
});

// POST /api/v1/auth/admin/seed-demo
// Duplicates project_id=1 for every non-admin user that doesn't already have a copy
router.post('/auth/admin/seed-demo', requireAuth, requireAdmin, (req, res) => {
  const con = db();
  try {
    const SOURCE_ID = 1;
    const source = con.prepare('SELECT * FROM project WHERE id = ?').get(SOURCE_ID);
    if (!source) return res.status(404).json({ error: 'Source project not found' });

    const users = con.prepare("SELECT id, username FROM user WHERE role != 'admin'").all();
    const results = [];

    for (const user of users) {
      // skip if user already owns a project with same ref
      const existing = con.prepare('SELECT id FROM project WHERE owner_id = ? AND ref = ?').get(user.id, source.ref);
      if (existing) { results.push({ username: user.username, skipped: true, project_id: existing.id }); continue; }

      // duplicate project
      const p = con.prepare(`INSERT INTO project (ref, name, client, contract_value, status, start_date, end_date, owner_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(source.ref, source.name, source.client, source.contract_value, source.status, source.start_date, source.end_date, user.id);
      const newPid = p.lastInsertRowid;

      // boq_item
      const boqItems = con.prepare('SELECT * FROM boq_item WHERE project_id = ?').all(SOURCE_ID);
      const boqIdMap = {};
      for (const r of boqItems) {
        const n = con.prepare(`INSERT INTO boq_item (project_id,schedule,item_ref,description,unit,qty,rate,contract_sum,type,section,iw_cost_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(newPid,r.schedule,r.item_ref,r.description,r.unit,r.qty,r.rate,r.contract_sum,r.type,r.section,r.iw_cost_code);
        boqIdMap[r.id] = n.lastInsertRowid;
      }

      // subcontracts + children
      const subs = con.prepare('SELECT * FROM subcontract WHERE project_id = ?').all(SOURCE_ID);
      const subIdMap = {};
      for (const s of subs) {
        const n = con.prepare(`INSERT INTO subcontract (project_id,subcontractor_id,ref,name,description,scope,value,start_date,end_date,status) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(newPid,s.subcontractor_id,s.ref,s.name,s.description,s.scope,s.value,s.start_date,s.end_date,s.status);
        subIdMap[s.id] = n.lastInsertRowid;
        // sub_boq_item
        for (const x of con.prepare('SELECT * FROM sub_boq_item WHERE subcontract_id = ?').all(s.id))
          con.prepare('INSERT INTO sub_boq_item (subcontract_id,boq_item_id,description,qty,rate,amount) VALUES (?,?,?,?,?,?)').run(subIdMap[s.id],boqIdMap[x.boq_item_id]??x.boq_item_id,x.description,x.qty,x.rate,x.amount);
        // sub_applications + children
        for (const sa of con.prepare('SELECT * FROM sub_application WHERE subcontract_id = ?').all(s.id)) {
          const na = con.prepare(`INSERT INTO sub_application (subcontract_id,week_ending,status,submitted_at,assessed_at,approved_at) VALUES (?,?,?,?,?,?)`).run(subIdMap[s.id],sa.week_ending,sa.status,sa.submitted_at,sa.assessed_at,sa.approved_at);
          const naId = na.lastInsertRowid;
          for (const x of con.prepare('SELECT * FROM sub_application_item WHERE sub_application_id = ?').all(sa.id))
            con.prepare('INSERT INTO sub_application_item (sub_application_id,boq_item_id,qty_this,qty_cumulative,rate,amount_this,amount_cumulative) VALUES (?,?,?,?,?,?,?)').run(naId,boqIdMap[x.boq_item_id]??x.boq_item_id,x.qty_this,x.qty_cumulative,x.rate,x.amount_this,x.amount_cumulative);
          for (const x of con.prepare('SELECT * FROM compensation_event WHERE sub_application_id = ?').all(sa.id))
            con.prepare('INSERT INTO compensation_event (sub_application_id,ref,description,amount,status) VALUES (?,?,?,?,?)').run(naId,x.ref,x.description,x.amount,x.status);
          for (const x of con.prepare('SELECT * FROM sub_invoice WHERE sub_application_id = ?').all(sa.id))
            con.prepare('INSERT INTO sub_invoice (sub_application_id,invoice_ref,amount,vat,received_at) VALUES (?,?,?,?,?)').run(naId,x.invoice_ref,x.amount,x.vat,x.received_at);
        }
        for (const x of con.prepare('SELECT * FROM sub_assessment WHERE subcontract_id = ?').all(s.id))
          con.prepare('INSERT INTO sub_assessment (subcontract_id,week_ending,amount_assessed,amount_certified,retention,notes) VALUES (?,?,?,?,?,?)').run(subIdMap[s.id],x.week_ending,x.amount_assessed,x.amount_certified,x.retention,x.notes);
      }

      // tracker_we + children
      const weRows = con.prepare('SELECT * FROM tracker_we WHERE project_id = ?').all(SOURCE_ID);
      for (const w of weRows) {
        const nw = con.prepare(`INSERT INTO tracker_we (project_id,week_ending,week_num,prelims_fixed,prelims_time,ae,civil,meica,landscape,commissioning,subs_cost,materials,plant,ohp,margin,efa) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(newPid,w.week_ending,w.week_num,w.prelims_fixed,w.prelims_time,w.ae,w.civil,w.meica,w.landscape,w.commissioning,w.subs_cost,w.materials,w.plant,w.ohp,w.margin,w.efa);
        for (const x of con.prepare('SELECT * FROM tracker_sub_revenue WHERE tracker_we_id = ?').all(w.id))
          con.prepare('INSERT INTO tracker_sub_revenue (tracker_we_id,subcontract_id,revenue) VALUES (?,?,?)').run(nw.lastInsertRowid,subIdMap[x.subcontract_id]??x.subcontract_id,x.revenue);
      }

      // payapp + payapp_item
      for (const pa of con.prepare('SELECT * FROM payapp WHERE project_id = ?').all(SOURCE_ID)) {
        const npa = con.prepare(`INSERT INTO payapp (project_id,app_num,app_date,works_gross_override,retention_pct,cert_num,cert_date,cert_gross,cert_net,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(newPid,pa.app_num,pa.app_date,pa.works_gross_override,pa.retention_pct,pa.cert_num,pa.cert_date,pa.cert_gross,pa.cert_net,pa.notes);
        for (const x of con.prepare('SELECT * FROM payapp_item WHERE payapp_id = ?').all(pa.id))
          con.prepare('INSERT INTO payapp_item (payapp_id,boq_item_id,pct_complete,amount) VALUES (?,?,?,?)').run(npa.lastInsertRowid,boqIdMap[x.boq_item_id]??x.boq_item_id,x.pct_complete,x.amount);
      }

      // payment_run
      for (const x of con.prepare('SELECT * FROM payment_run WHERE project_id = ?').all(SOURCE_ID))
        con.prepare('INSERT INTO payment_run (project_id,run_date,ref,description,amount,type) VALUES (?,?,?,?,?,?)').run(newPid,x.run_date,x.ref,x.description,x.amount,x.type);

      // das_entry + children
      for (const de of con.prepare('SELECT * FROM das_entry WHERE project_id = ?').all(SOURCE_ID)) {
        const nde = con.prepare(`INSERT INTO das_entry (project_id,entry_date,weather,notes,status) VALUES (?,?,?,?,?)`).run(newPid,de.entry_date,de.weather,de.notes,de.status);
        const ndeId = nde.lastInsertRowid;
        for (const x of con.prepare('SELECT * FROM das_labour WHERE das_entry_id = ?').all(de.id))
          con.prepare('INSERT INTO das_labour (das_entry_id,trade,name,hours,activity_code,notes) VALUES (?,?,?,?,?,?)').run(ndeId,x.trade,x.name,x.hours,x.activity_code,x.notes);
        for (const x of con.prepare('SELECT * FROM das_plant WHERE das_entry_id = ?').all(de.id))
          con.prepare('INSERT INTO das_plant (das_entry_id,plant_type,description,hours,activity_code,notes) VALUES (?,?,?,?,?,?)').run(ndeId,x.plant_type,x.description,x.hours,x.activity_code,x.notes);
        for (const x of con.prepare('SELECT * FROM das_activity WHERE das_entry_id = ?').all(de.id))
          con.prepare('INSERT INTO das_activity (das_entry_id,activity_code,description,qty,unit,notes) VALUES (?,?,?,?,?,?)').run(ndeId,x.activity_code,x.description,x.qty,x.unit,x.notes);
      }

      // das_next_week
      for (const x of con.prepare('SELECT * FROM das_next_week WHERE project_id = ?').all(SOURCE_ID))
        con.prepare('INSERT INTO das_next_week (project_id,week_ending,notes) VALUES (?,?,?)').run(newPid,x.week_ending,x.notes);

      // revenue_week + revenue_activity
      for (const rw of con.prepare('SELECT * FROM revenue_week WHERE project_id = ?').all(SOURCE_ID)) {
        const nrw = con.prepare('INSERT INTO revenue_week (project_id,week_ending,notes) VALUES (?,?,?)').run(newPid,rw.week_ending,rw.notes);
        for (const x of con.prepare('SELECT * FROM revenue_activity WHERE revenue_week_id = ?').all(rw.id))
          con.prepare('INSERT INTO revenue_activity (revenue_week_id,boq_item_id,qty,amount,notes) VALUES (?,?,?,?,?)').run(nrw.lastInsertRowid,boqIdMap[x.boq_item_id]??x.boq_item_id,x.qty,x.amount,x.notes);
      }

      // qs_cost_transaction
      for (const x of con.prepare('SELECT * FROM qs_cost_transaction WHERE project_id = ?').all(SOURCE_ID))
        con.prepare('INSERT INTO qs_cost_transaction (project_id,entry_date,category,description,amount,notes) VALUES (?,?,?,?,?,?)').run(newPid,x.entry_date,x.category,x.description,x.amount,x.notes);

      // excel_sub_cost
      for (const x of con.prepare('SELECT * FROM excel_sub_cost WHERE project_id = ?').all(SOURCE_ID))
        con.prepare('INSERT INTO excel_sub_cost (project_id,subcontract_id,week_ending,amount) VALUES (?,?,?,?)').run(newPid,subIdMap[x.subcontract_id]??x.subcontract_id,x.week_ending,x.amount);

      // boq_progress
      for (const x of con.prepare('SELECT * FROM boq_progress WHERE project_id = ?').all(SOURCE_ID))
        con.prepare('INSERT INTO boq_progress (project_id,boq_item_id,week_ending,pct_complete,qty_complete,notes) VALUES (?,?,?,?,?,?)').run(newPid,boqIdMap[x.boq_item_id]??x.boq_item_id,x.week_ending,x.pct_complete,x.qty_complete,x.notes);

      results.push({ username: user.username, created: true, project_id: Number(newPid) });
    }

    con.close();
    res.json({ ok: true, results });
  } catch (err) {
    try { con.close(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

function requireProjectAccess(req, res, next) {
  // req.params not yet populated at app.use level — read project id from raw URL
  const match = req.path.match(/^\/projects\/(\d+)/);
  if (!match) return next(); // not a project-specific route (e.g. GET /projects list)
  const projectId = match[1];
  const con = db();
  // owner OR member
  const access = con.prepare(`
    SELECT 'owner' AS role FROM project WHERE id = ? AND owner_id = ?
    UNION
    SELECT role FROM project_member WHERE project_id = ? AND user_id = ?
    LIMIT 1
  `).get(projectId, req.user.id, projectId, req.user.id);
  con.close();
  if (!access) return res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' });
  req.projectRole = access.role; // 'owner' | 'editor' | 'viewer'
  next();
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token', code: 'UNAUTHORIZED' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admin only', code: 'FORBIDDEN' });
  next();
}

// GET /api/v1/projects/:id/members
router.get('/projects/:id/members', requireAuth, (req, res) => {
  const con = db();
  const isOwner = con.prepare('SELECT id FROM project WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!isOwner) { con.close(); return res.status(403).json({ error: 'Only the project owner can manage members', code: 'FORBIDDEN' }); }
  const members = con.prepare(`
    SELECT u.id, u.username, u.role AS system_role, pm.role AS project_role
    FROM project_member pm JOIN user u ON u.id = pm.user_id
    WHERE pm.project_id = ?
  `).all(req.params.id);
  con.close();
  res.json(members);
});

// POST /api/v1/projects/:id/members
router.post('/projects/:id/members', requireAuth, (req, res) => {
  const { username, role = 'viewer' } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required', code: 'MISSING_FIELDS' });
  if (!['editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'role must be editor or viewer', code: 'INVALID_ROLE' });
  const con = db();
  const isOwner = con.prepare('SELECT id FROM project WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!isOwner) { con.close(); return res.status(403).json({ error: 'Only the project owner can add members', code: 'FORBIDDEN' }); }
  const user = con.prepare('SELECT id FROM user WHERE username = ?').get(username);
  if (!user) { con.close(); return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); }
  try {
    con.prepare('INSERT INTO project_member (project_id, user_id, role) VALUES (?, ?, ?)').run(req.params.id, user.id, role);
    con.close();
    res.status(201).json({ username, role });
  } catch {
    con.close();
    res.status(409).json({ error: 'User is already a member', code: 'DUPLICATE' });
  }
});

// DELETE /api/v1/projects/:id/members/:userId
router.delete('/projects/:id/members/:userId', requireAuth, (req, res) => {
  const con = db();
  const isOwner = con.prepare('SELECT id FROM project WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!isOwner) { con.close(); return res.status(403).json({ error: 'Only the project owner can remove members', code: 'FORBIDDEN' }); }
  con.prepare('DELETE FROM project_member WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  con.close();
  res.json({ ok: true });
});

function requireEditor(req, res, next) {
  // Only block mutating methods on project-specific routes where role is known
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.projectRole === 'viewer') {
    return res.status(403).json({ error: 'Read-only access', code: 'FORBIDDEN' });
  }
  next();
}

function runStartupMigrations() {
  const con = db();
  con.close();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.requireProjectAccess = requireProjectAccess;
module.exports.requireEditor = requireEditor;
module.exports.runStartupMigrations = runStartupMigrations;
