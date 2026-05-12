import type { WorkflowContext } from './queue-consumer.js';
import { run as helloWorldRun } from '../scripts/hello-world/script.js';
import { run as webhookEchoRun } from '../scripts/webhook-echo/script.js';
import { run as paginatedSyncRun } from '../scripts/paginated-sync-example/script.js';

// Add every worker-runtime script here. Static imports are required —
// Wrangler cannot bundle dynamic template-literal imports.
//
// Each entry maps a script `id` (matching scripts/<id>/metadata.json) to its
// `run` function. The id must also appear as a row in the `scripts` D1 table
// (see docs/adding-scripts.md step 6) or the dashboard won't show it.
export const scriptRegistry: Record<string, (ctx: WorkflowContext, params?: unknown) => Promise<void>> = {
  'hello-world':             helloWorldRun           as (ctx: WorkflowContext, params?: unknown) => Promise<void>,
  'webhook-echo':            webhookEchoRun          as (ctx: WorkflowContext, params?: unknown) => Promise<void>,
  'paginated-sync-example':  paginatedSyncRun        as (ctx: WorkflowContext, params?: unknown) => Promise<void>,
};
