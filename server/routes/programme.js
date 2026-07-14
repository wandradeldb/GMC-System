const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');
const { parseProgrammePdf } = require('../lib/programmeParser');
const { programmeUploadDir } = require('../lib/programmeStorage');

const router  = express.Router();
const DB_PATH = require('../db-path');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  con.exec(`CREATE TABLE IF NOT EXISTS project_programme (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    filename    TEXT    NOT NULL,
    file_path   TEXT    NOT NULL,
    uploaded_by TEXT,
    uploaded_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (project_id)
  )`);
  con.exec(`CREATE TABLE IF NOT EXISTS project_programme_activity (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    programme_id    INTEGER NOT NULL REFERENCES project_programme(id) ON DELETE CASCADE,
    seq             INTEGER NOT NULL,
    level           INTEGER NOT NULL DEFAULT 0,
    task_name       TEXT    NOT NULL,
    duration_label  TEXT,
    start_date      TEXT,
    finish_date     TEXT,
    predecessors    TEXT
  )`);
  con.exec('CREATE INDEX IF NOT EXISTS idx_programme_activity_programme ON project_programme_activity(programme_id)');
  return con;
}

function deleteProgrammeRow(con, row) {
  if (!row) return;
  con.prepare('DELETE FROM project_programme_activity WHERE programme_id=?').run(row.id);
  con.prepare('DELETE FROM project_programme WHERE id=?').run(row.id);
  try { fs.unlinkSync(row.file_path); } catch {}
}

// ── GET /projects/:pid/programme — metadata + parsed activities ────────────
router.get('/projects/:pid/programme', (req, res) => {
  const con = db();
  const { pid } = req.params;
  const programme = con.prepare('SELECT id, filename, uploaded_by, uploaded_at FROM project_programme WHERE project_id=?').get(pid);
  if (!programme) { con.close(); return res.json({ programme: null, activities: [] }); }
  const activities = con.prepare(
    'SELECT seq, level, task_name, duration_label, start_date, finish_date, predecessors FROM project_programme_activity WHERE programme_id=? ORDER BY seq'
  ).all(programme.id);
  con.close();
  res.json({ programme, activities });
});

// ── GET /projects/:pid/programme/file — stream the original PDF ────────────
router.get('/projects/:pid/programme/file', (req, res) => {
  const con = db();
  const { pid } = req.params;
  const programme = con.prepare('SELECT filename, file_path FROM project_programme WHERE project_id=?').get(pid);
  con.close();
  if (!programme || !fs.existsSync(programme.file_path)) {
    return res.status(404).json({ error: 'No programme uploaded', code: 'NOT_FOUND' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${programme.filename.replace(/[^\w.-]/g, '_')}"`);
  fs.createReadStream(programme.file_path).pipe(res);
});

// ── POST /projects/:pid/programme/upload — replaces any existing programme ─
router.post('/projects/:pid/programme/upload', upload.single('file'), async (req, res) => {
  const { pid } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });
  if (!/\.pdf$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: 'Only PDF files are supported', code: 'BAD_FILE_TYPE' });
  }

  let activities;
  try {
    activities = await parseProgrammePdf(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: `Could not read PDF: ${e.message}`, code: 'PARSE_FAILED' });
  }
  if (activities.length === 0) {
    return res.status(400).json({ error: 'No activities found in this PDF — is it a Gantt/schedule export?', code: 'NO_ACTIVITIES' });
  }

  const con = db();
  const existing = con.prepare('SELECT id, file_path FROM project_programme WHERE project_id=?').get(pid);
  deleteProgrammeRow(con, existing);

  const destPath = path.join(programmeUploadDir, `${pid}-${Date.now()}.pdf`);
  fs.writeFileSync(destPath, req.file.buffer);

  const uploadedBy = req.user?.username || null;
  const result = con.prepare(
    'INSERT INTO project_programme (project_id, filename, file_path, uploaded_by) VALUES (?,?,?,?)'
  ).run(pid, req.file.originalname, destPath, uploadedBy);
  const programmeId = Number(result.lastInsertRowid);

  const insertActivity = con.prepare(
    `INSERT INTO project_programme_activity (programme_id, seq, level, task_name, duration_label, start_date, finish_date, predecessors)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  for (const a of activities) {
    insertActivity.run(programmeId, a.seq, a.level, a.task_name, a.duration_label, a.start_date, a.finish_date, a.predecessors);
  }
  con.close();

  res.json({ ok: true, programme: { id: programmeId, filename: req.file.originalname }, activityCount: activities.length });
});

// ── DELETE /projects/:pid/programme ─────────────────────────────────────────
router.delete('/projects/:pid/programme', (req, res) => {
  const con = db();
  const { pid } = req.params;
  const existing = con.prepare('SELECT id, file_path FROM project_programme WHERE project_id=?').get(pid);
  deleteProgrammeRow(con, existing);
  con.close();
  res.json({ ok: true });
});

module.exports = router;
