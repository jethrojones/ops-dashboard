---
name: ops-add-script
description: Scaffolds a new automation script in the Ops Dashboard. Use when the user wants to add a new workflow, automation, or scheduled job. Walks through metadata, code, registry, D1 rows, and deploy.
---

# Add a script to the Ops Dashboard

Use this skill when the user wants to add a new automation to their
Ops Dashboard worker. It performs the full setup so the new
script shows up on the dashboard, runs on schedule, and reports
failures by email.

## Before you write code — talk to the user first

You **must** clarify these before writing any code:

1. **What does the script do?** One-sentence description.
2. **What does it talk to?** Which external services.
3. **When does it run?** Cron schedule (UTC, 5-field syntax) or manual-only.
4. **What inputs does it need?** Any per-run params. Almost every script
   should at least have a `dry_run` boolean defaulting to `true` for safety.
5. **What does success look like?** What should the log say at the end.

Vague specs produce broken scripts. Don't skip this step.

## Step 0 — sync everything first

Before changes:

```bash
git fetch origin
git status -sb
git pull --rebase
npm ci
npx wrangler whoami
npx wrangler deployments list | head -5
```

If the deployed Cloudflare version doesn't match the latest commit on
main, deploy first before adding more work.

## The 10-step checklist

### 1. `scripts/<id>/metadata.json`

```json
{
  "id": "my-script-id",
  "name": "Human Readable Name",
  "description": "One sentence describing what it does.",
  "runtime": "worker",
  "default_schedule": "0 14 * * 1-5",
  "business_hours_only": false,
  "required_secrets": ["hubspot"],
  "triggers": [
    { "type": "cron", "enabled": true },
    { "type": "manual", "enabled": true }
  ],
  "params_schema": [
    {
      "key": "dry_run",
      "label": "Dry run",
      "type": "boolean",
      "default": true,
      "description": "Log what would happen without making changes."
    }
  ]
}
```

Use `id` in `kebab-case`. Cron uses 5-field UTC syntax. **Default `dry_run`
to `true`** unless the user explicitly says otherwise — first runs
should never write to production until the user has reviewed dry-run output.

### 2. `scripts/<id>/script.ts`

```typescript
import type { WorkflowContext } from '../../src/queue-consumer.js';

export interface MyScriptParams {
  dry_run?: boolean;
}

export async function run(ctx: WorkflowContext, params?: MyScriptParams): Promise<void> {
  const dryRun = params?.dry_run ?? true;
  const hsToken = ctx.secrets.hubspot;
  if (!hsToken) throw new Error('hubspot secret is not configured');

  ctx.log('info', `Starting (dry_run=${dryRun})`);
  // ... do work, fetching with `await fetch(...)`, logging via ctx.log
  ctx.log('success', 'Done');
}
```

Rules:
- Default `dry_run` to `true` unless the operation is read-only.
- Secrets via `ctx.secrets.<lowercase_key>`. Match `required_secrets`.
- Logging via `ctx.log('info' | 'error' | 'success', message, optional_detail_object)`.
  Never `console.log`.
- Cloudflare Workers cap each invocation at **50 subrequests** on the free
  plan, 1000 on paid. Plan for it: pre-fetch lists once instead of
  per-iteration. Cap fan-out with a `batch_size` param.

### 3. Typecheck

```bash
npm run typecheck
```

Fix every error before continuing.

### 4. Register in `src/script-registry.ts`

```typescript
import { run as myScriptRun } from '../scripts/my-script-id/script.js';
// then in the registry object:
'my-script-id': myScriptRun as (ctx: WorkflowContext, params?: unknown) => Promise<void>,
```

### 5. Migration (only if you need a new D1 table)

Most scripts don't. If you do, file is `migrations/000N_description.sql`,
applied with:

```bash
npx wrangler d1 execute ops-dashboard --remote --file=migrations/000N_description.sql
```

### 6. Insert script row into D1

The dashboard reads scripts from D1. Until this row exists, the script is
invisible. The `metadata` column must contain the full JSON.

```bash
python3 -c "
import json
with open('scripts/my-script-id/metadata.json') as f:
    meta = json.load(f)
escaped = json.dumps(meta).replace(\"'\", \"''\")
print(f\"INSERT OR IGNORE INTO scripts (id, name, description, runtime, enabled, metadata, created_at, updated_at) VALUES ('my-script-id', 'Human Name', 'Description.', 'worker', 1, '{escaped}', datetime('now'), datetime('now'));\")
" > /tmp/insert_script.sql
npx wrangler d1 execute ops-dashboard --remote --file=/tmp/insert_script.sql
```

If you later edit `metadata.json`, run an `UPDATE` with the same
JSON-escape pattern — the D1 column does NOT auto-sync from the file.

### 7. Insert schedule row (cron scripts only)

```sql
INSERT OR IGNORE INTO schedules (script_id, cron_expression, timezone, business_hours_only, next_run_at, updated_at)
VALUES ('my-script-id', '0 14 * * 1-5', 'UTC', 0, datetime('now'), datetime('now'));
```

`next_run_at` MUST be set (`datetime('now')` is fine). NULL means the
scheduler ignores it forever.

### 8. Verify worker cron covers your schedule window

Open `wrangler.toml`. The worker's own cron decides when the scheduler
checks for due workflows. If your script fires outside the configured
window, widen the trigger first.

### 9. Deploy

```bash
npm run deploy
```

### 10. `scripts/<id>/SKILL.md`

Document: purpose, schedule, required secrets, params, known failure modes.

## API keys / secrets

If the script needs an API key the console doesn't already have, **stop
before deploy** and tell the user:

> "This script needs a `<service>` API key. Go to **Settings →
> Connections** in the ops dashboard and click **Edit** for `<service>`.
> Then come back and I'll continue."

Do not paste keys into chat. Do not commit keys. The console encrypts
them in D1 and exposes them at runtime via `ctx.secrets.<key>`. The
secret key in D1 must match the lowercase string in `required_secrets`.

## Test plan after deploy

1. Open the dashboard. Confirm the new card appears.
2. Click **Run now**. Set `dry_run` true (it's the default). Verify the log.
3. If it looks good, run again with `dry_run` false (only if the user
   confirms).
4. If it has a cron, leave the next scheduled run to fire naturally.

## Common mistakes — avoid these

- **Forgetting step 6** (D1 INSERT). Script is in the registry and deployed but the dashboard doesn't show it.
- **NULL `next_run_at`** on the schedules row. Cron never fires.
- **Plain-English cron strings**. Must be 5-field syntax.
- **Subrequest budget**: looping with 4 fetches per item × 50 items = 200 requests = blown. Pre-fetch, batch, or cap with a `max_items` / `batch_size` param.
- **`dry_run` defaulting to false** on first version. Always start at true.
- **Skipping typecheck**. Catch type holes with `npm run typecheck` before deploying.

## When something fails

The console emails the configured recipients when a script fails. The error
category is one of: `auth`, `rate_limit`, `network`, `schema`, `unknown`. The
run detail page has a **Copy for Claude** button — that bundles the source,
the full log, and the error into one payload that an LLM can use to diagnose.
