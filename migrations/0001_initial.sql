-- Ops Dashboard — Initial Schema
-- D1 SQLite (max 500MB, 2MB/row, 50 queries/invocation on Free)

CREATE TABLE IF NOT EXISTS scripts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  runtime     TEXT NOT NULL DEFAULT 'worker' CHECK (runtime IN ('worker', 'workflow', 'external')),
  enabled     INTEGER NOT NULL DEFAULT 1,
  version_sha TEXT,
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  script_id            TEXT PRIMARY KEY REFERENCES scripts(id) ON DELETE CASCADE,
  cron_expression      TEXT,
  next_run_at          TEXT,
  timezone             TEXT NOT NULL DEFAULT 'America/New_York',
  business_hours_only  INTEGER NOT NULL DEFAULT 1,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  script_id      TEXT NOT NULL REFERENCES scripts(id),
  status         TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
  trigger_type   TEXT NOT NULL CHECK (trigger_type IN ('cron', 'webhook', 'drive', 'manual')),
  trigger_detail TEXT,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  duration_ms    INTEGER,
  error_category TEXT CHECK (error_category IN ('auth', 'rate_limit', 'network', 'schema', 'unknown', NULL)),
  error_summary  TEXT,
  log_r2_key     TEXT,
  version_sha    TEXT,
  triggered_by   TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  service         TEXT PRIMARY KEY,
  encrypted_blob  TEXT NOT NULL,
  last_rotated_at TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id               TEXT PRIMARY KEY,
  service          TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  received_at      TEXT NOT NULL,
  signature_valid  INTEGER NOT NULL DEFAULT 1,
  run_id           TEXT REFERENCES runs(id),
  routing_decision TEXT CHECK (routing_decision IN ('routed', 'skipped', 'rejected'))
);

CREATE TABLE IF NOT EXISTS drive_state (
  folder_id                TEXT PRIMARY KEY,
  script_id                TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  page_token               TEXT,
  last_check_at            TEXT,
  last_successful_check_at TEXT,
  last_error               TEXT,
  backoff_until            TEXT,
  dedup_index              TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS usage_counters (
  resource   TEXT NOT NULL,
  date       TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (resource, date)
);

CREATE TABLE IF NOT EXISTS audit (
  id           TEXT PRIMARY KEY,
  user_email   TEXT NOT NULL,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  before_value TEXT,
  after_value  TEXT,
  ip_address   TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deploy_jobs (
  id            TEXT PRIMARY KEY,
  script_id     TEXT NOT NULL REFERENCES scripts(id),
  initiated_by  TEXT NOT NULL,
  branch_name   TEXT NOT NULL,
  pr_number     INTEGER,
  pr_sha        TEXT,
  parent_sha    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'testing', 'merging', 'deploying', 'deployed', 'failed', 'rolled_back')),
  stage_detail  TEXT,
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  error_message TEXT,
  is_rollback   INTEGER NOT NULL DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_runs_script_id  ON runs(script_id);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status     ON runs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_service ON webhook_events(service, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_script   ON deploy_jobs(script_id, started_at DESC);
