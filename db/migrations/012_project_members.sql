CREATE TABLE IF NOT EXISTS project_member (
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES user(id)    ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'viewer',
  PRIMARY KEY (project_id, user_id)
);
