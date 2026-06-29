-- Camada 3: isolamento por owner
-- Cada projecto tem um dono (owner_id -> user.id)
-- Projectos existentes ficam atribuídos ao utilizador admin (id=1)

ALTER TABLE project ADD COLUMN owner_id INTEGER REFERENCES user(id);
UPDATE project SET owner_id = 1 WHERE owner_id IS NULL;
