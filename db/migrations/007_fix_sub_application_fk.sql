-- Migration 007 — Repara as foreign keys penduradas para "sub_application_old".
--
-- Contexto: a migração 006 (período → week_ending) recriou a tabela
-- sub_application via rename. Esse rename fez o SQLite reescrever as
-- referências FK das tabelas-filho para "sub_application_old", que foi depois
-- removida. Resultado: qualquer INSERT em sub_application_item falhava com
-- "no such table: main.sub_application_old" (com PRAGMA foreign_keys=ON).
--
-- As tabelas-filho estão vazias, por isso recriamo-las apenas com a FK correcta
-- a apontar para sub_application. Deve ser executado com foreign_keys=OFF, dentro
-- de uma transacção (ver run_migration_007.js).

DROP TABLE IF EXISTS sub_application_item;
CREATE TABLE sub_application_item (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_application_id  INTEGER NOT NULL REFERENCES sub_application(id) ON DELETE CASCADE,
    sub_boq_item_id     INTEGER NOT NULL REFERENCES sub_boq_item(id) ON DELETE CASCADE,
    qty_complete_sub    REAL    NOT NULL DEFAULT 0,
    value_sub_computed  INTEGER DEFAULT 0,
    qty_complete_gmc    REAL    NOT NULL DEFAULT 0,
    value_gmc_computed  INTEGER DEFAULT 0,
    notes               TEXT,
    pct_complete_sub    REAL    NOT NULL DEFAULT 0,
    pct_complete_gmc    REAL    NOT NULL DEFAULT 0,
    pct_prev            REAL    NOT NULL DEFAULT 0
);

DROP TABLE IF EXISTS compensation_event;
CREATE TABLE compensation_event (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    subcontract_id      INTEGER NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
    sub_application_id  INTEGER REFERENCES sub_application(id) ON DELETE SET NULL,
    ce_ref              TEXT    NOT NULL,
    description         TEXT    NOT NULL,
    sub_value           REAL    NOT NULL DEFAULT 0,
    gmc_value           REAL    NOT NULL DEFAULT 0,
    status              TEXT    NOT NULL DEFAULT 'submitted'
                                CHECK (status IN ('submitted','assessed','agreed','rejected')),
    approved_date       TEXT,
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (subcontract_id, ce_ref)
);
CREATE TRIGGER IF NOT EXISTS trg_ce_updated
AFTER UPDATE ON compensation_event FOR EACH ROW
BEGIN UPDATE compensation_event SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;

DROP TABLE IF EXISTS sub_invoice;
CREATE TABLE sub_invoice (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_application_id  INTEGER NOT NULL REFERENCES sub_application(id) ON DELETE CASCADE,
    invoice_number      TEXT    NOT NULL,
    invoice_date        TEXT    NOT NULL,
    gross_amount        REAL    NOT NULL DEFAULT 0,
    retention_amount    REAL    NOT NULL DEFAULT 0,
    net_amount          REAL    GENERATED ALWAYS AS (ROUND(gross_amount - retention_amount, 2)) VIRTUAL,
    sent_finance_date   TEXT,
    payment_run_id      INTEGER REFERENCES payment_run(id) ON DELETE SET NULL,
    payment_date        TEXT,
    status              TEXT    NOT NULL DEFAULT 'received'
                                CHECK (status IN ('received','sent_to_finance','scheduled','paid','disputed')),
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (sub_application_id, invoice_number)
);
CREATE TRIGGER IF NOT EXISTS trg_invoice_updated
AFTER UPDATE ON sub_invoice FOR EACH ROW
BEGIN UPDATE sub_invoice SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;
