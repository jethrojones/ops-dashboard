# Paginated Sync (Example)

Template for syncing items from one API ("source") into another
("destination"), one chunk per cron run.

**This script will not run as-is.** The URLs point to nonexistent example
domains. Treat it as a copy-paste starting point for a real integration.

## Pattern

- Read a cursor from D1 (`sync_state` table, scope `paginated-sync-example`).
- Fetch one page of items from the source.
- Optionally fetch detail for each item.
- Upsert the batch into the destination.
- Save the new cursor (or delete it if there's nothing more to sync).

By doing exactly one page per invocation, you stay within the **50
subrequest per Workers invocation** cap on the free plan. The math is:

| Step                                  | Subrequests          |
|---------------------------------------|----------------------|
| List page from source                 | 1                    |
| Detail fetches (one per item)         | `batch_size` (≤ 40)  |
| Batch upsert to destination           | 1                    |
| **Total**                             | `batch_size + 2`     |

`batch_size` is hard-capped at 40 in `script.ts` (the `Math.min(..., 40)`
line) so even if someone passes a higher value via the Run-now modal, the
worker never blows the cap. Set to 40 for a 7-subrequest safety margin
against unexpected extra fetches (e.g. an auth refresh).

## Params

- `dry_run` (boolean, default `true`) — fetch and log, but don't write.
- `reset` (boolean, default `false`) — discard the cursor and restart.
- `batch_size` (number, default `40`, max `40`) — items per run.

## Required secrets

- `source_api_token` — bearer token for the source API.
- `destination_api_token` — bearer token for the destination API.

Both go in **Settings → Connections**.

## D1 table

Cursor persistence uses the generic `sync_state` table (created in
migration `0005_sync_state.sql`). If you want script-specific state
columns, add your own table in a new migration.

## Scaling beyond 50 subrequests

If you outgrow this:

1. **Upgrade to Workers Paid ($5/month)** — the per-invocation limit goes
   to 1000. Bump `batch_size` to 100+ and you sync much faster.
2. **Run more often** — `*/5 * * * *` (every 5 min) instead of
   `0 14 * * 1-5` (once a day).
3. **Use `[wrangler] Workflows`** for truly long-running, multi-step
   pipelines. Beyond the scope of this template.

## Failure modes

- **"Too many subrequests"** — `batch_size` exceeds the platform cap.
  Lower it. Most likely you removed the `Math.min(..., 40)` cap; restore it.
- **Cursor stuck** — a run failed before saving the cursor. Next run starts
  from the previous cursor automatically. If you want to skip past the
  problematic record, set `reset: true` and the script restarts from
  the beginning.
- **Auth error** — token expired or scopes changed. Rotate in Settings →
  Connections.
