const { DatabaseSync } = require('node:sqlite');
const XLSX = require('./server/node_modules/xlsx');
const fs = require('fs');
const path = require('path');

const XLSX_PATH = 'C:/Users/wagne/Downloads/GMC/W03-26 Merlin Park Pumping Station (version 2).xlsx';
const db = new DatabaseSync(path.join(__dirname, 'db/gmc.db'));

// Pré-classificação do sub por secção (editável depois na UI)
//  SC-001 Right Group=1 · SC-002 Folan=3 · SC-003 Tir3D=4 · SC-004 Silverhill=5 · SC-005 Woolpert=6
const SECTION_SUB = {
  'Prelim Fixed': null,   // GMC
  'Prelim Time':  null,   // GMC
  'Civil Works':  3,      // Folan
  'MEICA Works':  1,      // Right Group
  'Landscape':    null,
  'Commission':   1,      // Right Group (MEICA commissioning)
};

try {
  console.log('🔄 Migração 008 — Revenue Generation…');
  db.exec(fs.readFileSync(path.join(__dirname, 'db/migrations/008_revenue_generation.sql'), 'utf8'));

  const existing = db.prepare('SELECT COUNT(*) c FROM revenue_activity WHERE project_id=1').get().c;
  if (existing > 0) {
    console.log(`ℹ️  revenue_activity já tem ${existing} linhas — seed ignorado.`);
    process.exit(0);
  }

  // Ler atividades da planilha
  const wb = XLSX.readFile(XLSX_PATH);
  const sh = wb.Sheets['Revenue Generator'];
  const range = XLSX.utils.decode_range(sh['!ref']);
  const g = (r, c) => { const x = sh[XLSX.utils.encode_cell({ r, c })]; return x == null ? null : x.v; };

  const ins = db.prepare(`
    INSERT INTO revenue_activity (project_id, ref, description, qty, unit, rate, contract_value, section, default_sub_id, sort_order)
    VALUES (1,?,?,?,?,?,?,?,?,?)
  `);
  db.exec('BEGIN');
  let n = 0;
  for (let r = 5; r <= range.e.r; r++) {
    const ref = g(r, 1);
    if (ref == null || String(ref).trim() === '') continue;     // só linhas com ref
    const desc = String(g(r, 2) || '').trim();
    const qty = typeof g(r, 3) === 'number' ? g(r, 3) : 0;
    const unit = String(g(r, 4) || '').trim();
    const rate = typeof g(r, 5) === 'number' ? g(r, 5) : 0;
    const section = String(g(r, 11) || '').trim();
    if (!section) continue;
    const contract = Math.round(qty * rate * 100) / 100;
    ins.run(String(ref).trim(), desc, qty, unit, rate, contract, section, SECTION_SUB[section] ?? null, n);
    n++;
  }
  db.exec('COMMIT');

  const tot = db.prepare('SELECT ROUND(SUM(contract_value),2) v, COUNT(*) c FROM revenue_activity WHERE project_id=1').get();
  console.log(`✅ Importadas ${tot.c} atividades · Σ contract €${tot.v}`);
  db.prepare("SELECT section, COUNT(*) c, ROUND(SUM(contract_value),2) v FROM revenue_activity WHERE project_id=1 GROUP BY section").all()
    .forEach(s => console.log(`   ${s.section}: ${s.c} (€${s.v})`));
} catch (e) {
  try { db.exec('ROLLBACK'); } catch {}
  console.error('❌ Erro:', e.message);
  process.exit(1);
} finally {
  db.close();
}
