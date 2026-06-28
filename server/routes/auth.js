const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');
const DB_PATH  = require('../db-path');

const router   = express.Router();
const SECRET   = process.env.JWT_SECRET || 'gmc-dev-secret-change-in-prod';
const EXPIRES  = '8h';

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

// POST /api/v1/auth/login
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required', code: 'MISSING_FIELDS' });

  const con  = db();
  const user = con.prepare('SELECT * FROM user WHERE username = ?').get(username);
  con.close();

  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });

  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: EXPIRES });
  res.json({ token, username: user.username });
});

// POST /api/v1/auth/users  — create user (admin only)
router.post('/auth/users', requireAuth, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required', code: 'MISSING_FIELDS' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const con = db();
    con.prepare('INSERT INTO user (username, password) VALUES (?, ?)').run(username, hash);
    con.close();
    res.status(201).json({ username });
  } catch (e) {
    res.status(409).json({ error: 'Username already exists', code: 'DUPLICATE_USER' });
  }
});

// GET /api/v1/auth/users
router.get('/auth/users', requireAuth, (req, res) => {
  const con   = db();
  const users = con.prepare('SELECT id, username, created_at FROM user').all();
  con.close();
  res.json(users);
});

// DELETE /api/v1/auth/users/:id
router.delete('/auth/users/:id', requireAuth, (req, res) => {
  const con = db();
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
    res.status(401).json({ error: 'Invalid token', code: 'UNAUTHORIZED' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
