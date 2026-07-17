// Local-only verification tool — NOT the production-application mechanism. The real schema
// change is applied automatically via CREATE TABLE IF NOT EXISTS in server/routes/tracker.js
// and server/routes/revenue.js's db() helpers (this repo has no migration-runner reachable
// against the persistent Railway volume). This script just lets us eyeball the backfill math
// against a local copy of the DB before trusting the same logic to self-apply in production.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'db/gmc.db'));
const sql = fs.readFileSync(path.join(__dirname, 'db/migrations/017_flexible_revenue_categories.sql'), 'utf8');

try {
  console.log('🔄 Aplicando migração 017 (categorias de receita flexíveis)…');

  const already = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracker_we_category'").get();
  if (already) {
    console.log('ℹ️  tracker_we_category já existe — migração já aplicada, pulando.');
  } else {
    db.exec('BEGIN');
    db.exec(sql);
    db.exec('COMMIT');
    console.log('✅ Tabela tracker_we_category criada e backfill executado.');
  }

  const counts = db.prepare('SELECT project_id, category, COUNT(*) c, ROUND(SUM(revenue),2) v FROM tracker_we_category GROUP BY project_id, category ORDER BY project_id, category').all();
  console.log(`\n📊 tracker_we_category — ${counts.length} grupo(s) projeto/categoria:`);
  counts.forEach(r => console.log(`   project ${r.project_id} · ${r.category}: ${r.c} semanas · €${r.v}`));

  // Safety check: legacy sum vs new table sum must match to the cent, per week, for every
  // project that has tracker_we history (not just project 1 — local db/gmc.db's "Merlin Park"
  // may not be project 1 depending on environment, so check all projects generically).
  const rows = db.prepare(`
    SELECT t.project_id, t.week_ending,
      ROUND(t.rev_prelims_fixed + t.rev_prelims_time + t.rev_civil + t.rev_meica + t.rev_landscape + t.rev_commissioning + t.rev_ae, 2) AS legacy_sum,
      (SELECT ROUND(COALESCE(SUM(revenue),0),2) FROM tracker_we_category c WHERE c.project_id = t.project_id AND c.week_ending = t.week_ending) AS new_sum
    FROM tracker_we t ORDER BY t.project_id, t.week_ending
  `).all();

  const mismatches = rows.filter(r => Math.abs(r.legacy_sum - r.new_sum) > 0.01);
  console.log(`\n🔍 Conferência: ${rows.length} semana(s) no total, ${mismatches.length} divergência(s).`);
  if (mismatches.length) {
    console.error('❌ Divergências encontradas (legacy_sum vs new_sum):');
    mismatches.forEach(r => console.error(`   project ${r.project_id}, WE ${r.week_ending}: legacy=€${r.legacy_sum} novo=€${r.new_sum}`));
    process.exit(1);
  }
  console.log('✅ Todas as semanas batem exatamente entre as colunas antigas e a tabela nova.');
} catch (e) {
  try { db.exec('ROLLBACK'); } catch {}
  console.error('❌ Erro:', e.message);
  process.exit(1);
} finally {
  db.close();
}
