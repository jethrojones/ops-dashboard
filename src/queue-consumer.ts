// Queue consumer handler — executes a workflow from a QueueMessage.
// The actual queue() logic lives in src/index.ts as handleQueue().
// Wrangler routes queue messages to the default export's `queue` handler.
//
// This file provides the WorkflowContext type used by all script.ts modules.

import type { Env, LogStep, RunLog } from './types.js';

/**
 * ScriptEnv is the subset of the worker Env that scripts can see.
 *
 * Platform-only secrets are stripped — scripts should never need to know
 * the master encryption key, the Cloudflare Access AUD, the GitHub PAT,
 * or the Resend key. Anything they DO need (decrypted service tokens) is
 * loaded into `ctx.secrets` by the queue consumer before run() is called.
 *
 * Defense in depth: a hostile or buggy script can still query the `secrets`
 * D1 table directly, but without the master key it can't decrypt the
 * stored blobs.
 */
export type ScriptEnv = Omit<Env,
  | 'OPS_SECRETS_MASTER_KEY'
  | 'CF_ACCESS_AUD'
  | 'GITHUB_PAT'
  | 'GITHUB_APP_PRIVATE_KEY'
  | 'GITHUB_APP_ID'
  | 'GITHUB_INSTALLATION_ID'
  | 'RESEND_API_KEY'
  | 'CALLBACK_AUTH_SECRET'
>;

/**
 * WorkflowContext is the object passed to every script's run() function.
 */
export interface WorkflowContext {
  scriptId: string;
  runId: string;
  // Decrypted values for the keys listed in this script's `required_secrets`.
  secrets: Record<string, string>;
  // Append to the verbose run log. Use this instead of console.log — only
  // ctx.log entries show up on the run detail page. Values matching any
  // live secret value are redacted before persistence.
  log: (type: LogStep['type'], message: string, detail?: unknown) => void;
  // Convenience handle for D1.
  db: D1Database;
  // Sanitized env for advanced scripts that need bindings (R2, KV, queues,
  // Durable Objects, vars). Platform secrets are stripped — see ScriptEnv.
  env: ScriptEnv;
}

/**
 * Build the sanitized env scripts see. Strips platform-only secrets,
 * keeps the bindings and runtime vars.
 */
export function buildScriptEnv(env: Env): ScriptEnv {
  return {
    DB: env.DB,
    LOGS: env.LOGS,
    CACHE: env.CACHE,
    WORKFLOW_LOCK: env.WORKFLOW_LOCK,
    USAGE_COUNTER: env.USAGE_COUNTER,
    WEBHOOK_DEDUP: env.WEBHOOK_DEDUP,
    DISPATCH_QUEUE: env.DISPATCH_QUEUE,
    APP_DOMAIN: env.APP_DOMAIN,
    CF_TEAM_DOMAIN: env.CF_TEAM_DOMAIN,
    RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL,
    NOTIFY_EMAILS: env.NOTIFY_EMAILS,
    GITHUB_REPO_OWNER: env.GITHUB_REPO_OWNER,
    GITHUB_REPO_NAME: env.GITHUB_REPO_NAME,
    GITHUB_SCRIPTS_PATH: env.GITHUB_SCRIPTS_PATH,
    SCHEDULER_TZ: env.SCHEDULER_TZ,
    FREE_WORKER_REQUESTS_DAY: env.FREE_WORKER_REQUESTS_DAY,
    FREE_D1_WRITES_DAY: env.FREE_D1_WRITES_DAY,
    FREE_KV_WRITES_DAY: env.FREE_KV_WRITES_DAY,
    FREE_QUEUE_OPS_DAY: env.FREE_QUEUE_OPS_DAY,
    FREE_R2_CLASS_A_MONTH: env.FREE_R2_CLASS_A_MONTH,
  };
}

/**
 * Build a redactor that replaces any of the given live secret values with
 * `***REDACTED***` in log messages and details. Wraps `ctx.log` so scripts
 * that accidentally log a token don't leak it into R2 + Copy-for-Claude.
 *
 * Values shorter than 8 chars are skipped (too noisy to match safely).
 */
export function buildLogRedactor(liveSecretValues: string[]): (text: unknown) => unknown {
  const significant = liveSecretValues.filter(v => typeof v === 'string' && v.length >= 8);
  if (significant.length === 0) return (x) => x;
  return (value: unknown): unknown => {
    if (value == null) return value;
    if (typeof value === 'string') {
      let s = value;
      for (const v of significant) s = s.split(v).join('***REDACTED***');
      return s;
    }
    if (typeof value === 'object') {
      try {
        let s = JSON.stringify(value);
        for (const v of significant) s = s.split(v).join('***REDACTED***');
        return JSON.parse(s);
      } catch {
        return value;
      }
    }
    return value;
  };
}

/**
 * Queue consumer execution flow (implemented in src/index.ts → handleQueue):
 *
 * For each message in the batch:
 * 1. Parse QueueMessage
 * 2. Look up Script from D1
 * 3. Decrypt required secrets from D1 secrets table
 * 4. Build the WorkflowContext + log redactor
 * 5. Based on runtime:
 *    - 'worker' / 'workflow': call scriptRegistry[id](ctx, payload)
 *    - 'external': POST to GitHub Actions dispatch API
 * 6. On completion: update run row (status=success, duration_ms, ended_at, log_r2_key)
 *                   write RunLog to R2
 *                   unlock WorkflowLock DO
 * 7. On failure: categorize error, update run row (status=failed)
 *                write RunLog to R2
 *                send failure email via lib/resend.ts
 *                unlock WorkflowLock DO
 * 8. message.ack() in both cases (no retries — failures are logged, not retried silently)
 *
 * R2 key format: runs/{runId}.json
 */

export type { RunLog };
