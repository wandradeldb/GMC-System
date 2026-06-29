ALTER TABLE user ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer';
UPDATE user SET role = 'admin' WHERE username = 'admin';
