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
  // DAS photo
  try { con.exec("ALTER TABLE das_entry ADD COLUMN photo_url TEXT"); } catch {}
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
  const { username, password, role = 'user', seed_demo = false } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required', code: 'MISSING_FIELDS' });
  if (!['admin', 'user'].includes(role))
    return res.status(400).json({ error: 'Invalid role', code: 'INVALID_ROLE' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const con = db();
    const r = con.prepare('INSERT INTO user (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);
    const newUserId = r.lastInsertRowid;

    let demo_project_id = null;
    let demo_error = null;
    if (seed_demo && role !== 'admin') {
      try { demo_project_id = seedDemoForUser(con, { id: newUserId, username }); }
      catch (err) { demo_error = err.message; }
    }

    con.close();
    res.status(201).json({ username, role, demo_project_id, demo_error });
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

// Shared helper: duplicate the project with the most BOQ items for a single user. Returns new project_id or null if skipped.
function seedDemoForUser(con, user) {
  // Pick the project with the most BOQ data — that's the real Merlin Park
  const source = con.prepare(`
    SELECT p.* FROM project p
    LEFT JOIN boq_item b ON b.project_id = p.id
    GROUP BY p.id ORDER BY COUNT(b.id) DESC LIMIT 1
  `).get();
  if (!source) return null;

  const demoRef = `${source.ref} (demo-${user.username})`;
  const existing = con.prepare('SELECT id FROM project WHERE owner_id = ? AND ref = ?').get(user.id, demoRef);
  if (existing) return null; // already has a copy

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

  const p = con.prepare(`INSERT INTO project (ref,name,client,contract_value,status,start_date,end_date,owner_id)
    VALUES (?,?,?,?,?,?,?,?)`).run(demoRef, source.name, source.client, source.contract_value,
    source.status, source.start_date, source.end_date, user.id);
  const newPid = p.lastInsertRowid;
  const SOURCE_ID = source.id;

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

  return Number(newPid);
}

// POST /api/v1/auth/admin/seed-demo
// Duplicates project_id=1 for every non-admin user that doesn't already have a copy
router.post('/auth/admin/seed-demo', requireAuth, requireAdmin, (req, res) => {
  const con = db();
  try {
    const users = con.prepare("SELECT id, username FROM user WHERE role != 'admin'").all();
    const results = [];
    for (const user of users) {
      try {
        const newId = seedDemoForUser(con, user);
        if (newId) results.push({ username: user.username, created: true, project_id: newId });
        else {
          const ex = con.prepare('SELECT id FROM project WHERE owner_id = ?').get(user.id);
          results.push({ username: user.username, skipped: true, project_id: ex?.id });
        }
      } catch (err) {
        results.push({ username: user.username, error: err.message });
      }
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
