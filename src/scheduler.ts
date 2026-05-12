// Scheduled handler — finds workflows due to run and enqueues them.
// Called every minute by Cloudflare cron: "*/1 5-23 * * *"
// This file exists for documentation/import purposes.
// The actual scheduled() logic lives in src/index.ts as handleScheduled().
// wrangler routes the scheduled event to the default export's `scheduled` handler.

// Re-export types used by the scheduler for clarity
export type { Env, QueueMessage } from './types.js';

// Cron schedule notes:
//
// The wrangler.toml cron trigger fires every minute from 5:00–23:59 UTC, every day.
// This covers 1am–7pm Eastern in both EST (UTC-5) and EDT (UTC-4).
//
// The scheduler checks:
// 1. Circuit breaker (skip if D1/KV/queue usage >= 95%)
// 2. Business hours check (per-script business_hours_only flag)
// 3. Due workflows: scripts JOIN schedules WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at <= now
//    AND (business_hours_only=0 OR in_business_hours)
// 4. For each due workflow:
//    a. Acquire WorkflowLock DO (skip if locked)
//    b. Insert run row (status: 'running')
//    c. Send QueueMessage to DISPATCH_QUEUE
//    d. Compute and update next_run_at from cron expression
//
// Cron next-run computation handles:
// - Every-N-minutes patterns
// - Range+step patterns (e.g. 9-17/2 = every 2 hours from 9 to 17)
// - Hourly, daily, weekday, day-of-week range/comma patterns
//
// IMPORTANT: next_run_at must NOT be NULL on schedule insert. The scheduler
// query filters on IS NOT NULL — a null value means the script never fires.
//
// The full implementation is in src/index.ts → runScheduler().
