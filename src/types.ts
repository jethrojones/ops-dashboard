export interface Env {
  // D1 — relational state
  DB: D1Database;
  // R2 — verbose run logs + debug payloads (optional: requires R2 enabled in Cloudflare dashboard)
  LOGS?: R2Bucket;
  // KV — disposable cache only
  CACHE: KVNamespace;
  // Durable Objects
  WORKFLOW_LOCK: DurableObjectNamespace;
  USAGE_COUNTER: DurableObjectNamespace;
  WEBHOOK_DEDUP: DurableObjectNamespace;
  // Queue
  DISPATCH_QUEUE: Queue<QueueMessage>;

  // Vars (wrangler.toml [vars])
  APP_DOMAIN: string;
  CF_TEAM_DOMAIN: string;
  RESEND_FROM_EMAIL: string;
  NOTIFY_EMAILS: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  GITHUB_SCRIPTS_PATH: string;
  SCHEDULER_TZ: string;
  FREE_WORKER_REQUESTS_DAY: string;
  FREE_D1_WRITES_DAY: string;
  FREE_KV_WRITES_DAY: string;
  FREE_QUEUE_OPS_DAY: string;
  FREE_R2_CLASS_A_MONTH: string;

  // Secrets (wrangler secret put)
  OPS_SECRETS_MASTER_KEY: string;
  CF_ACCESS_AUD: string;
  GITHUB_PAT: string;  // Personal Access Token — repo + workflow scopes
  // GitHub App fields (optional, future upgrade — leave blank for now)
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  RESEND_API_KEY: string;
  // Required if you use external-runtime scripts that POST back to
  // /api/webhook/github-callback. The callback must include this value
  // in the X-Callback-Secret header.
  CALLBACK_AUTH_SECRET: string;
}

export type Runtime = 'worker' | 'workflow' | 'external';
export type RunStatus = 'running' | 'success' | 'failed' | 'skipped';
export type TriggerType = 'cron' | 'webhook' | 'drive' | 'manual';
export type ErrorCategory = 'auth' | 'rate_limit' | 'network' | 'schema' | 'unknown';
export type DeployStatus = 'pending' | 'testing' | 'merging' | 'deploying' | 'deployed' | 'failed' | 'rolled_back';

export interface Script {
  id: string;
  name: string;
  description: string;
  runtime: Runtime;
  enabled: boolean;
  version_sha: string | null;
  metadata: ScriptMetadata;
  created_at: string;
  updated_at: string;
}

export interface ParamSchema {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'string' | 'textarea';
  required?: boolean;
  default?: boolean | number | string;
  description: string;
}

export interface ScriptMetadata {
  default_schedule?: string;
  triggers?: TriggerConfig[];
  required_secrets?: string[];
  required_drive_folders?: string[];
  github_workflow_id?: string;
  business_hours_only?: boolean;
  params_schema?: ParamSchema[];
}

export interface TriggerConfig {
  type: TriggerType;
  service?: string;
  event?: string;
  folder_id?: string;
  enabled: boolean;
}

export interface Schedule {
  script_id: string;
  cron_expression: string | null;
  next_run_at: string | null;
  timezone: string;
  business_hours_only: boolean;
  updated_at: string;
}

export interface Run {
  id: string;
  script_id: string;
  status: RunStatus;
  trigger_type: TriggerType;
  trigger_detail: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  error_category: ErrorCategory | null;
  error_summary: string | null;
  log_r2_key: string | null;
  version_sha: string | null;
  triggered_by: string | null;
  created_at: string;
  github_run_url: string | null;
}

export interface Secret {
  service: string;
  encrypted_blob: string;
  last_rotated_at: string | null;
  created_at: string;
}

export interface DeployJob {
  id: string;
  script_id: string;
  initiated_by: string;
  branch_name: string;
  pr_number: number | null;
  pr_sha: string | null;
  parent_sha: string | null;
  status: DeployStatus;
  stage_detail: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  is_rollback: boolean;
}

export interface QueueMessage {
  type: 'run_workflow' | 'run_webhook' | 'run_drive_check' | 'run_external';
  script_id: string;
  run_id: string;
  trigger_type: TriggerType;
  trigger_detail?: string;
  triggered_by?: string;
  payload?: unknown;
}

export interface AccessUser {
  email: string;
  sub: string;
  name?: string;
}

export interface RunLog {
  run_id: string;
  script_id: string;
  steps: LogStep[];
  captured_at: string;
}

export interface LogStep {
  seq: number;
  ts: string;
  type: 'info' | 'api_call' | 'api_response' | 'error' | 'success';
  message: string;
  detail?: unknown;
  duration_ms?: number;
  status_code?: number;
}

export interface PastebackEnvelope {
  version: 'v1';
  workflow_id: string;
  parent_sha: string;
  files: Record<string, string>;
}

export interface UsageSnapshot {
  resource: string;
  date: string;
  count: number;
  limit: number;
  pct: number;
}
