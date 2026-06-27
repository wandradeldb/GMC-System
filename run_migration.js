const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const db = new DatabaseSync('./db/gmc.db');

try {
  console.log('🔄 Aplicando migração 006...');

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');

  // Criar nova tabela
  db.exec(`
    CREATE TABLE sub_application_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subcontract_id INTEGER NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
      application_number INTEGER NOT NULL,
      week_ending TEXT NOT NULL,
      value_sub REAL NOT NULL DEFAULT 0,
      value_gmc REAL NOT NULL DEFAULT 0,
      delta REAL GENERATED ALWAYS AS (ROUND(value_gmc - value_sub, 2)) VIRTUAL,
      cumulative_sub REAL NOT NULL DEFAULT 0,
      cumulative_gmc REAL NOT NULL DEFAULT 0,
      retention_held REAL GENERATED ALWAYS AS (ROUND(cumulative_gmc * 0, 2)) VIRTUAL,
      net_payable REAL NOT NULL DEFAULT 0,
      qs_approved_by TEXT,
      qs_approved_date TEXT,
      invoice_requested INTEGER NOT NULL DEFAULT 0 CHECK (invoice_requested IN (0,1)),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','assessed','approved','invoiced','paid')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE (subcontract_id, application_number),
      UNIQUE (subcontract_id, week_ending)
    )
  `);

  // Migrar dados com resolução de conflitos
  const rows = db.prepare('SELECT * FROM sub_application ORDER BY subcontract_id, period, id').all();
  const seen = {};
  const insert = db.prepare(`
    INSERT INTO sub_application_new (
      id, subcontract_id, application_number, week_ending,
      value_sub, value_gmc, cumulative_sub, cumulative_gmc, net_payable,
      qs_approved_by, qs_approved_date, invoice_requested, status, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    const key = `${row.subcontract_id}-${row.period}`;
    const count = (seen[key] || 0) + 1;
    seen[key] = count;

    // Converter period YYYY-MM para week_ending com offset para duplicatas
    const baseDate = row.period + '-05'; // First Friday approximation
    const daysOffset = (count - 1) * 7;
    const d = new Date(baseDate + 'T00:00:00Z');
    d.setDate(d.getDate() + daysOffset);
    const weekEnding = d.toISOString().split('T')[0];

    insert.run(
      row.id, row.subcontract_id, row.application_number, weekEnding,
      row.value_sub, row.value_gmc, row.cumulative_sub, row.cumulative_gmc, row.net_payable,
      row.qs_approved_by, row.qs_approved_date, row.invoice_requested, row.status, row.notes,
      row.created_at, row.updated_at
    );
  }

  // Drop old table
  db.exec('DROP TABLE sub_application');
  db.exec('ALTER TABLE sub_application_new RENAME TO sub_application');

  // Recreate indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_sub_app_subcontract ON sub_application(subcontract_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sub_app_week ON sub_application(week_ending)');

  // Recreate trigger
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_sub_app_updated
    AFTER UPDATE ON sub_application FOR EACH ROW
    BEGIN UPDATE sub_application SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END
  `);

  db.exec('COMMIT');
  db.exec('PRAGMA foreign_keys = ON');

  console.log('✅ Migração aplicada com sucesso');

  // Verify
  const check = db.prepare('SELECT COUNT(*) as cnt FROM sub_application').get();
  console.log('✅ sub_application agora tem', check.cnt, 'registros com week_ending');

  const sample = db.prepare('SELECT id, subcontract_id, week_ending FROM sub_application LIMIT 3').all();
  console.log('   Sample:', sample);

} catch (e) {
  try { db.exec('ROLLBACK'); } catch {}
  console.error('❌ Erro:', e.message);
  process.exit(1);
} finally {
  db.close();
}
