-- 005: Extend subcontractor table with GMC supplier code & short name
ALTER TABLE subcontractor ADD COLUMN code       TEXT;
ALTER TABLE subcontractor ADD COLUMN short_name TEXT;
ALTER TABLE subcontractor ADD COLUMN balance    REAL DEFAULT 0;
ALTER TABLE subcontractor ADD COLUMN credit_limit REAL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_code ON subcontractor(code) WHERE code IS NOT NULL;
