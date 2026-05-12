# Adding scripts

How to add a new workflow to the Ops Dashboard. There are 10 steps.
**Skip nothing** — the two most common ways to deploy a broken workflow
are forgetting step 6 (the D1 INSERT) or step 7 (the schedules row).

If you're handing this to an LLM, the project also ships an
[`ops-add-script` skill](../.claude/skills/ops-add-script/SKILL.md) that
makes this much harder to get wrong.

---

## Before you start: clarify what you're building

A vague spec ("add a follow-up reminder thing") produces a broken script.
Pin down at least:

1. **What does it do?** One sentence.
2. **What does it talk to?** Which APIs, in what direction (read/write/both).
3. **When does it run?** Cron schedule (5-field UTC syntax), webhook, or manual-only.
4. **What params does it need?** Almost every script should at minimum have
   `dry_run: boolean = true`. Add others if the script accepts input.
5. **What does success look like?** What should the verbose log say at the end.

If you can't answer all five, write them down first. Don't write code yet.

---

## Step 0: sync your environment first

Before adding anything, make sure your local repo matches what's deployed.

```bash
git fetch origin
git status -sb            # local vs remote
git pull --rebase         # update local
npm ci                    # in case package.json changed
npx wrangler whoami
npx wrangler deployments list | head -5
```

If the latest deployed version doesn't match `git log -1 --format=%h`,
deploy first (`npm run deploy`) to bring production in line with the
codebase before adding more work.

---

## Step 1: `scripts/<id>/metadata.json`

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

Field reference:

- **`id`** — `kebab-case`. Must match the folder name. Also the key in the
  scripts D1 row and `script-registry.ts`.
- **`runtime`** — `worker` (runs inside this worker), `workflow` (same, kept
  for future use), or `external` (dispatches to GitHub Actions).
- **`default_schedule`** — 5-field UTC cron. Examples:
  - `0 14 * * 1-5` — weekdays at 14:00 UTC
  - `*/15 * * * 0` — every 15 minutes on Sundays
  - `0 9,17 * * *` — 9:00 and 17:00 UTC, every day
- **`business_hours_only`** — if true, the scheduler skips ticks outside
  Mon–Fri 10:00–23:00 UTC. Useful for jobs that depend on humans being
  available.
- **`required_secrets`** — list of D1 secret keys the script reads. Must
  match the lowercase keys in **Settings → Connections**. The runtime
  decrypts these and passes them as `ctx.secrets.<key>`.
- **`triggers`** — list of how this script can be invoked:
  - `{ "type": "cron", "enabled": true }` — schedule-driven.
  - `{ "type": "webhook", "service": "stripe", "event": "invoice.paid", "enabled": true }`
    — fires on POST to `/webhooks/stripe/invoice.paid`.
  - `{ "type": "manual", "enabled": true }` — "Run now" button on the dashboard.
- **`params_schema`** — defines the form fields shown in the Run-now modal.
  Types: `boolean`, `number`, `string`, `textarea`.

---

## Step 2: `scripts/<id>/script.ts`

```typescript
import type { WorkflowContext } from '../../src/queue-consumer.js';

export interface MyScriptParams {
  dry_run?: boolean;
  // add other params from params_schema here
}

export async function run(ctx: WorkflowContext, params?: MyScriptParams): Promise<void> {
  const dryRun = params?.dry_run ?? true;
  const hsToken = ctx.secrets.hubspot;
  if (!hsToken) throw new Error('hubspot secret is not configured');

  ctx.log('info', `Starting (dry_run=${dryRun})`);

  // Do work here. Use `await fetch(...)` for HTTP.
  // Log every meaningful step with ctx.log — it goes into the verbose log.

  ctx.log('success', 'Done');
}
```

Rules:

- **Default `dry_run` to `true`** unless the script is purely read-only.
  First runs of a new script must be previewable before they make real changes.
- **Secrets** via `ctx.secrets.<lowercase_key>`. Names must match
  `required_secrets` in metadata.
- **Logging** via `ctx.log('info' | 'error' | 'success', message, optional_detail_object)`.
  Never use `console.log` — those don't show up on the run detail page.
- **Throw** to fail the run. The queue consumer catches, marks failed,
  emails. **Return** to succeed.
- **Cloudflare Workers cap each invocation at 50 subrequests** on the
  free plan, **1000 on paid**. Plan for it: pre-fetch lists once instead
  of per-iteration, batch where possible, cap fan-out with a `batch_size`
  param. See `scripts/paginated-sync-example/` for the pattern.

---

## Step 3: Typecheck

```bash
npm run typecheck
```

Fix every error before continuing. LLM-written scripts often have unused
imports or `any` slip-ins.

---

## Step 4: Register in `src/script-registry.ts`

Two edits, both required:

```typescript
// Add the import (with the rest of them at the top):
import { run as myScriptRun } from '../scripts/my-script-id/script.js';

// Add the map entry:
export const scriptRegistry: Record<...> = {
  // ... existing entries
  'my-script-id': myScriptRun as (ctx: WorkflowContext, params?: unknown) => Promise<void>,
};
```

If the import is missing, Wrangler still bundles successfully but the
queue consumer will throw `Script 'my-script-id' is not registered` at
runtime.

---

## Step 5: Migration (only if you need a new D1 table)

Most scripts don't. The generic `sync_state` table (migration `0005`)
handles cursors and key/value state for any script.

If you do need a typed table:

```bash
# Create the file. Number sequentially from the last migration.
cat > migrations/0006_my_script_data.sql <<EOF
CREATE TABLE IF NOT EXISTS my_script_data (
  id          TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
EOF

# Apply it to the deployed D1.
npx wrangler d1 execute ops-dashboard --remote --file=migrations/0006_my_script_data.sql

# Also apply locally if you use wrangler dev.
npx wrangler d1 execute ops-dashboard --local --file=migrations/0006_my_script_data.sql
```

---

## Step 6: Insert the `scripts` row into D1

**The dashboard reads scripts from D1, not from disk.** Until this row
exists, your script is invisible in the UI.

The cleanest way is to build the INSERT from `metadata.json` so the JSON
matches exactly:

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

If you later edit `metadata.json` (e.g. add a param), **the D1 row does
not auto-sync.** Run an UPDATE with the same escape pattern:

```bash
python3 -c "
import json
with open('scripts/my-script-id/metadata.json') as f:
    meta = json.load(f)
escaped = json.dumps(meta).replace(\"'\", \"''\")
print(f\"UPDATE scripts SET metadata = '{escaped}', updated_at = datetime('now') WHERE id = 'my-script-id';\")
" > /tmp/update_script.sql

npx wrangler d1 execute ops-dashboard --remote --file=/tmp/update_script.sql
```

---

## Step 7: Insert the `schedules` row (cron scripts only)

```sql
INSERT OR IGNORE INTO schedules
  (script_id, cron_expression, timezone, business_hours_only, next_run_at, updated_at)
VALUES
  ('my-script-id', '0 14 * * 1-5', 'UTC', 0, datetime('now'), datetime('now'));
```

Run it:

```bash
npx wrangler d1 execute ops-dashboard --remote --command "INSERT OR IGNORE INTO schedules (script_id, cron_expression, timezone, business_hours_only, next_run_at, updated_at) VALUES ('my-script-id', '0 14 * * 1-5', 'UTC', 0, datetime('now'), datetime('now'));"
```

**`next_run_at` MUST NOT be NULL.** The scheduler query filters on
`next_run_at IS NOT NULL AND next_run_at <= ?` — a NULL means it'll
never fire. Use `datetime('now')` to make it fire on the next scheduler tick.

---

## Step 8: Verify the worker's own cron covers your script's window

Open `wrangler.toml`. The worker's `triggers.crons` setting decides when
the scheduler **even checks** for due scripts. The default is:

```toml
[triggers]
crons = ["*/1 5-23 * * *"]
```

That's every minute, 5:00–23:59 UTC. If your script's cron fires at 3:00
UTC (outside the worker's window), it'll be marked as due but no
scheduler tick will pick it up until 5:00 UTC.

For 24-hour coverage:

```toml
crons = ["*/1 * * * *"]
```

Be aware: more cron ticks = more worker requests = more of your free-tier
budget. The default 19-hour window covers most use cases.

---

## Step 9: Deploy

```bash
npm run deploy
```

Output should end with `Current Version ID: <uuid>`. If the deploy fails,
read the error — common ones:

- **`Could not find Durable Object class WorkflowLock`** — your
  `wrangler.toml` is missing the `[[migrations]]` block. Re-copy from
  `wrangler.toml.example`.
- **`D1 binding "DB" not found`** — `database_id` is still the placeholder
  string.
- **`Could not bind queue "ops-dashboard-dispatch"`** — you haven't created
  it yet. Run `npx wrangler queues create ops-dashboard-dispatch`.

---

## Step 10: `scripts/<id>/SKILL.md`

Document what the script does, its params, its failure modes. This is the
file an LLM will read when something breaks. Look at
`scripts/paginated-sync-example/SKILL.md` for a template.

---

## Test plan after deploy

1. Open the dashboard. Confirm the new card appears.
2. Click **Run now**. Leave `dry_run` on. Verify the log on the run detail page.
3. If it looks right, click **Run now** again with `dry_run` OFF.
4. If it has a cron, just leave it — the next scheduled tick will fire.

---

## Common mistakes (avoid these)

- **Forgetting step 6** (the D1 INSERT). Script is registered and deployed
  but the dashboard doesn't show it.
- **NULL `next_run_at`** in the schedules row. Cron will never fire.
- **Plain-English cron strings** ("every Monday morning"). Must be 5-field
  syntax.
- **Subrequest budget**: looping with 4 fetches per item × 50 items = 200
  requests = blown. Pre-fetch lists, batch where possible, cap fan-out.
- **`dry_run` defaulting to `false`** on first version. Always start at
  `true` so first runs are previewable.
- **Skipping typecheck**. Catch type holes before deploying.
- **`console.log` instead of `ctx.log`**. console output isn't captured
  in the verbose log.
