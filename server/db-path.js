const path = require('path');
const fs   = require('fs');

const APP_DB    = path.join(__dirname, '../db/gmc.db');
const VOLUME_DB = '/data/gmc.db';

if (process.env.NODE_ENV === 'production') {
  if (fs.existsSync('/data')) {
    if (!fs.existsSync(VOLUME_DB) && fs.existsSync(APP_DB)) {
      fs.copyFileSync(APP_DB, VOLUME_DB);
      console.log('DB seeded from repo to volume:', VOLUME_DB);
    }
    module.exports = VOLUME_DB;
  } else {
    // No volume mounted — use the db bundled in the image
    module.exports = APP_DB;
  }
} else {
  module.exports = process.env.DB_PATH || APP_DB;
}
