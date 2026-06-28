// Run once: node server/seed-admin.js <password>
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const DB_PATH = require('./db-path');

const password = process.argv[2];
if (!password) { console.error('Usage: node server/seed-admin.js <password>'); process.exit(1); }

const con  = new DatabaseSync(DB_PATH, { open: true });
con.exec(`CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const hash = bcrypt.hashSync(password, 10);
try {
  con.prepare('INSERT INTO user (username, password) VALUES (?, ?)').run('admin', hash);
  console.log('Admin user created.');
} catch {
  con.prepare('UPDATE user SET password = ? WHERE username = ?').run(hash, 'admin');
  console.log('Admin password updated.');
}
con.close();
