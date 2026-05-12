CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  user_email    TEXT NOT NULL,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
