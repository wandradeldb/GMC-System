// Resolves where uploaded Programme PDFs live on disk, mirroring db-path.js's
// logic: prefer the persistent Railway volume (/data) when mounted, since the
// app's own directory is wiped on every deploy; fall back to a local dev folder.
const path = require('path');
const fs   = require('fs');

const dir = fs.existsSync('/data')
  ? '/data/uploads/programme'
  : path.join(__dirname, '../uploads/programme');

fs.mkdirSync(dir, { recursive: true });

module.exports = { programmeUploadDir: dir };
