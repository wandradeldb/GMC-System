const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'db/gmc.db'));
const sql = fs.readFileSync(path.join(__dirname, 'db/migrations/007_fix_sub_application_fk.sql'), 'utf8');

try {
  console.log('🔄 Aplicando migração 007 (repara FKs sub_application_old)…');

  // Confirmar que as filhas estão vazias antes de recriar
  for (const t of ['sub_application_item', 'compensation_event', 'sub_invoice']) {
    const n = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    if (n > 0) throw new Error(`${t} tem ${n} linhas — abortar (esperava 0). Migra os dados manualmente.`);
  }

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  db.exec(sql);
  db.exec('COMMIT');

  const viol = db.prepare('PRAGMA foreign_key_check').all();
  if (viol.length) throw new Error('FK violations após migração: ' + JSON.stringify(viol));
  db.exec('PRAGMA foreign_keys = ON');

  // Verificar que já não há referências a sub_application_old
  const bad = db.prepare("SELECT name FROM sqlite_master WHERE sql LIKE '%sub_application_old%'").all();
  if (bad.length) throw new Error('Ainda há refs a sub_application_old: ' + JSON.stringify(bad));

  console.log('✅ Migração 007 aplicada — FKs apontam para sub_application, sem violações.');
} catch (e) {
  try { db.exec('ROLLBACK'); } catch {}
  console.error('❌ Erro:', e.message);
  process.exit(1);
} finally {
  db.close();
}
