# Architecture

How the pieces fit. Read this once before touching the platform code.

## The big picture

```
   ┌────────────────────────────────┐
   │     Cloudflare Access (SSO)    │   gate every request to the worker
   └──────────────┬─────────────────┘
                  │
                  ▼
   ┌────────────────────────────────┐
   │     Worker (src/index.ts)      │   HTML pages + JSON API
   │       (Hono routes here)       │
   └──┬──────────────────────────┬──┘
      │                          │
      ▼                          ▼
 [scheduled]                  [queue]
   every minute              one run at a time
      │                          │
      ▼                          ▼
 runScheduler()             handleQueue()
      │                          │
      │                          ▼
      │              runs script from scripts/<id>/script.ts
      │                          │
      ▼                          ▼
 enqueue due workflows     write log to R2,
 onto DISPATCH_QUEUE       update D1 run row
                                  │
                                  ▼
                          on failure → email via Resend


   ┌─────────────────────────────────────────────┐
   │ Persistence (Cloudflare-managed)            │
   ├─────────────────────────────────────────────┤
   │  D1 (SQLite)          relational state      │
   │  R2 (object store)    verbose run logs      │
   │  KV                   short-lived cache     │
   │  Durable Objects      locks + dedup + counts│
   │  Queues               work dispatch         │
   └─────────────────────────────────────────────┘
```

## Request flow: a workflow runs

1. **Cron fires.** Every minute (UTC 5–23 by default), Cloudflare invokes
   `handleScheduled()` → `runScheduler()`.
2. **Sweeper.** Before checking what's due, `sweepStaleRuns()` scans the
   `runs` table for rows stuck in `'running'` for >15 minutes. Each gets
   transitioned to `'failed'`, its lock is released, and a failure email
   is sent. This is the platform's only recovery from CPU-time kills,
   which silently bypass the queue consumer's `catch` block.
3. **Find due workflows.** SELECT from `scripts JOIN schedules` where
   `enabled = 1 AND next_run_at <= NOW()`.
4. **For each due script, in parallel:**
   - **Try to acquire its lock** via the `WorkflowLock` Durable Object.
     If already locked, skip (some prior run is still in flight).
   - **Insert a `runs` row** with `status='running'`.
   - **Enqueue** a `QueueMessage` onto `DISPATCH_QUEUE`.
   - **Compute** the next `next_run_at` from the cron expression.
5. **Queue consumer picks up** the message and invokes `handleQueue()`:
   - Loads the script row, parses metadata, decrypts secrets it needs.
   - Builds a `WorkflowContext` (`ctx`) with `secrets`, `db`, `log`.
   - Calls `scriptRegistry[id](ctx, msg.payload)`.
   - On success: writes log to R2, updates run row to `success`, releases the lock.
   - On caught failure: same, but `status='failed'` and sends a Resend email.
   - On platform timeout / CPU-kill: nothing fires here. The sweeper above
     catches it on the next minute tick.

## Request flow: a webhook arrives

1. POST to `/webhooks/:service/:event`.
2. The worker verifies the `X-Webhook-Secret` header against the value
   stored in D1 under `<service>_webhook_secret`. Returns 401 if mismatched.
3. Decodes the JSON body.
4. Calls `enqueueWebhook()`:
   - Finds a script with a matching `webhook` trigger.
   - Inserts a `runs` row.
   - Optionally checks `WebhookDedup` if the upstream sends an idempotency
     header (avoids double-runs from retried deliveries).
   - Enqueues the work.
5. Returns 200 immediately. The worker confirms receipt without waiting
   for the script to finish — providers will hit the timeout otherwise.

## Why these specific persistence choices

| Concern                    | Choice                | Why                                                                      |
|----------------------------|-----------------------|--------------------------------------------------------------------------|
| Workflows + runs + secrets | **D1**                | Relational, SQL is easy, no per-row $$, 100k writes/day free.            |
| Verbose run logs           | **R2**                | Logs can be large; D1 rows have 2MB limit. R2 is cheap object storage.   |
| JWKs cache, conn-status    | **KV**                | Read-heavy, 60s+ TTLs; cheap reads, but only 1k writes/day (don't write-heavy KV). |
| Per-workflow lock          | **WorkflowLock DO**   | DO storage is strongly consistent + cheap. KV is eventually consistent — would race. |
| Daily usage counters       | **UsageCounter DO**   | Same — atomic counter ops every request would burn KV's 1k/day cap.      |
| Webhook dedup              | **WebhookDedup DO**   | Strongly consistent test-and-set; expires after 24h.                     |
| Job dispatch               | **Queues**            | Bursts get absorbed; retries free; consumer gets isolation per invocation. |
| Auth                       | **Cloudflare Access** | Free SSO, JWT verifiable inside the worker, no auth code needed.         |

## Durability guarantees

- **A workflow run starts only after the D1 `runs` row + the `WorkflowLock`
  + the queue send all succeed.** If any of those fail, no run.
- **A workflow run is marked `success` or `failed` IFF the queue
  consumer's caught path runs.** Platform kills (CPU time, OOM, etc.) leave
  the row at `'running'`. The 15-minute stale-run sweeper recovers these.
- **Run logs in R2 are best-effort.** If R2 fails to write, the run still
  succeeds and the log row in D1 has `log_r2_key = NULL`. The run detail
  page handles this gracefully.
- **Webhook deliveries are at-least-once.** The dedup DO collapses
  duplicates that arrive within 24h with the same key. If a webhook
  provider doesn't send an idempotency key, you'll get a run per delivery.

## What's NOT durable

- **In-script in-memory state.** Workers are per-invocation; nothing
  survives. Persist via `ctx.db` or `ctx.env.CACHE`.
- **Anything written by the script BEFORE it throws.** The queue consumer
  doesn't roll back. If your script writes to HubSpot and then crashes
  before logging success, HubSpot still got the write. Design idempotent
  scripts.

## How to add a new script (in 30 seconds)

Full version: [adding-scripts.md](adding-scripts.md). The 30-second version:

1. `scripts/my-script/metadata.json` — id, schedule, params, required_secrets.
2. `scripts/my-script/script.ts` — exports `async function run(ctx, params)`.
3. Add it to `src/script-registry.ts`.
4. `INSERT INTO scripts (...) VALUES ('my-script', ...)` in D1.
5. `INSERT INTO schedules (script_id, cron_expression, next_run_at, ...)` for cron scripts.
6. `npm run deploy`.

## Cost model

Free-plan numbers on Workers in late 2025:

| Resource              | Free daily/monthly cap              | Where we use it                                           |
|-----------------------|-------------------------------------|-----------------------------------------------------------|
| Worker requests       | 100k / day                          | Every page load, API call, webhook, cron tick.            |
| D1 writes             | 100k / day                          | Every run row insert/update, secret rotation, audit log.  |
| D1 reads              | 25M / day                           | Effectively unbounded for us.                             |
| KV writes             | 1k / day                            | JWKs cache (per Access JWT signing key change).           |
| Queue ops             | 10k / day                           | Once per scheduled or manual workflow run.                |
| R2 class-A ops        | 1M / month                          | One PUT per run log + one GET per "Copy for Claude".      |
| Durable Object reqs   | 1M / month                          | Lock check + counter increments per run.                  |

The circuit breaker (`src/lib/usage.ts`) trips at 95% of any of the
*per-day* caps to keep you out of the $5/month tier. Worker requests are
exempt (the worker can't usefully refuse to handle its own requests).

If you're consistently above 80% on any resource, that's a signal to
upgrade or to optimize the script.

## Single load-bearing file

If you only read one source file to understand the platform, read
[`src/index.ts`](../src/index.ts). It's 900 lines but contains the full
router, scheduler, queue consumer, webhook receiver, paste-back deploy
glue, and the stale-run sweeper. Every other file is a leaf.
