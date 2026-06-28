const path = require('path');
const fs   = require('fs');

const VOLUME_PATH = '/data/gmc.db';
const LOCAL_PATH  = path.join(__dirname, '../db/gmc.db');

// In production, use the persistent volume. Seed from repo on first deploy.
if (process.env.NODE_ENV === 'production') {
  if (!fs.existsSync(VOLUME_PATH)) {
    fs.mkdirSync('/data', { recursive: true });
    fs.copyFileSync(LOCAL_PATH, VOLUME_PATH);
    console.log('DB seeded from repo to volume:', VOLUME_PATH);
  }
  module.exports = VOLUME_PATH;
} else {
  module.exports = process.env.DB_PATH || LOCAL_PATH;
}
