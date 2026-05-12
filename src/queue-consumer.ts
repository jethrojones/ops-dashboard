// Queue consumer handler — executes a workflow from a QueueMessage.
// The actual queue() logic lives in src/index.ts as handleQueue().
// wrangler routes queue messages to the default export's `queue` handler.
//
// This file provides the WorkflowContext type used by all script.ts modules.

import type { Env, LogStep, RunLog } from './types.js';

/**
 * WorkflowContext is the object passed to every script's run() function.
 *
 * It provides:
 * - scriptId: the script's ID
 * - runId: the current run's UUID
 * - secrets: decrypted secret values keyed by service name
 * - log: function to append to the verbose RunLog
 * - db: the D1 database binding
 * - env: the full Env (for advanced scripts that need it)
 */
export interface WorkflowContext {
  scriptId: string;
  runId: string;
  secrets: Record<string, string>;
  log: (type: LogStep['type'], message: string, detail?: unknown) => void;
  db: D1Database;
  env: Env;
}

/**
 * Queue consumer execution flow (implemented in src/index.ts → handleQueue):
 *
 * For each message in the batch:
 * 1. Parse QueueMessage
 * 2. Look up Script from D1
 * 3. Decrypt required secrets from D1 secrets table
 * 4. Build WorkflowContext
 * 5. Based on runtime:
 *    - 'worker' / 'workflow': dynamic import scripts/{id}/script.js, call run(ctx, payload)
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
 * The RunLog is built as steps are executed via ctx.log().
 * R2 key format: runs/{runId}.json
 */

// Export helper types for use by scripts
export type { RunLog };
