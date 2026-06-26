const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'gmc.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

// Execute each statement individually (better-sqlite3 doesn't support multi-statement exec)
const statements = schema
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

for (const stmt of statements) {
  try {
    db.prepare(stmt).run();
  } catch (err) {
    // PRAGMA and GENERATED COLUMN definitions need exec, not prepare
    db.exec(stmt + ';');
  }
}

const project = db.prepare('SELECT * FROM project WHERE ref = ?').get('W03/26');
console.log('Project seeded:', project);

console.log('Tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());

db.close();
console.log('Database initialised at', DB_PATH);
