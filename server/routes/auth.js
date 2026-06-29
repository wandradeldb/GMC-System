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
  try { con.exec("ALTER TABLE user ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'"); } catch {}
  try { con.exec("UPDATE user SET role = 'admin' WHERE username = 'admin' AND role = 'viewer'"); } catch {}
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
    { id: user.id, username: user.username, role: user.role || 'viewer' },
    SECRET,
    { expiresIn: EXPIRES }
  );
  res.json({ token, username: user.username, role: user.role || 'viewer' });
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
  const { username, password, role = 'viewer' } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required', code: 'MISSING_FIELDS' });
  if (!['admin', 'viewer'].includes(role))
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

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
