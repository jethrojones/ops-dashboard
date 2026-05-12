-- Generic key/value store for paginated-sync cursors and other
-- per-script state. Add scoped rows from your scripts via:
--   INSERT INTO sync_state (scope, key, value, updated_at)
--   VALUES ('my-script', 'cursor', 'abc123', datetime('now'))
--   ON CONFLICT(scope, key) DO UPDATE SET ...
--
-- Add a dedicated table in its own migration if you need typed columns.

CREATE TABLE IF NOT EXISTS sync_state (
  scope      TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
