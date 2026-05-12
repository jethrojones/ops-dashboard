# Cloudflare setup — zero to deployed

Step-by-step walkthrough from a fresh Cloudflare account to a running
ops dashboard. If you do every step in order, you should be done in
30–45 minutes. **Skip nothing** — the orphaned-D1-row and missing-Durable-Object
class are the two most common ways to get a half-deployed worker that
silently does nothing.

If you're handing this guide to an LLM: paste this whole file and ask it
to execute step-by-step, asking you for confirmation between any commands
that create paid resources or commit to a domain.

---

## What you'll need

- A Cloudflare account (free is fine).
- A domain you own, parked at Cloudflare DNS (any registrar works — Cloudflare
  will manage the DNS). You can also use `*.workers.dev` for testing without
  a custom domain, but Cloudflare Access only works on custom domains.
- `node` 20+ and `npm` installed locally.
- A GitHub account (needed only if you'll use the paste-back deploy flow).
- About 30–45 minutes.

The free Cloudflare plan covers everything in this guide. You don't need
Workers Paid unless you outgrow 50 subrequests per script invocation.

---

## 1. Install Wrangler and sign in

[Wrangler](https://developers.cloudflare.com/workers/wrangler/) is the
Cloudflare Workers CLI.

```bash
npm install -g wrangler
# or just `npx wrangler ...` everywhere — no global install needed
```

Sign in to your Cloudflare account:

```bash
npx wrangler login
```

This opens a browser. Click **Allow** to authorize Wrangler. Confirm:

```bash
npx wrangler whoami
```

You should see your email and account ID. Copy the **account ID** — you'll
paste it into `wrangler.toml` in the next step.

---

## 2. Clone the repo and configure `wrangler.toml`

```bash
git clone https://github.com/jethrojones/ops-dashboard.git
cd ops-dashboard
npm install
cp wrangler.toml.example wrangler.toml
```

Open `wrangler.toml` and replace these placeholders:

| Placeholder                                | What to put                                                                |
|--------------------------------------------|----------------------------------------------------------------------------|
| `REPLACE_WITH_YOUR_CLOUDFLARE_ACCOUNT_ID`  | Your account ID from `wrangler whoami`.                                    |
| `APP_DOMAIN`                               | The domain you'll deploy to (e.g. `ops.example.com`).                      |
| `CF_TEAM_DOMAIN`                           | Your Cloudflare Zero Trust team subdomain (configured later in step 7).    |
| `RESEND_FROM_EMAIL`                        | A verified sender on a domain you own (e.g. `ops@example.com`). Skip if you're not using Resend yet — failure emails just won't send. |
| `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`    | Your fork's GitHub owner/repo (used by the paste-back flow).               |

Leave the resource IDs (`database_id`, KV `id`) as placeholders for now —
we'll fill them in as we create each resource.

---

## 3. Create the D1 database

D1 is Cloudflare's SQLite-compatible managed database. Free plan: 500MB
storage, 5GB/day read, 100k writes/day, 25M reads/day.

```bash
npx wrangler d1 create ops-dashboard
```

Output ends with a `[[d1_databases]]` block. **Copy the `database_id`** and
paste it into `wrangler.toml` where it says `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

Apply migrations:

```bash
npm run db:migrate
```

This creates the tables (`scripts`, `runs`, `schedules`, `secrets`,
`webhook_events`, `usage_counters`, `audit`, `audit_log`, `deploy_jobs`,
`settings`, `sync_state`).

To inspect: `npx wrangler d1 execute ops-dashboard --remote --command "SELECT
name FROM sqlite_master WHERE type='table';"`

---

## 4. Create the KV namespace

KV stores short-lived cached values: Cloudflare Access JWKs (1-hour TTL)
and connection-check results (2-minute TTL). Free plan: 1k writes/day,
which is plenty for caching.

```bash
npx wrangler kv namespace create CACHE
```

Output prints an `id`. **Paste it** into `wrangler.toml` where it says
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

---

## 5. Create the dispatch queue

Workflows are dispatched through Cloudflare Queues — the scheduler enqueues,
the consumer picks up and runs. Free plan covers 10k queue operations/day.

```bash
npx wrangler queues create ops-dashboard-dispatch
```

The queue is already wired up in `wrangler.toml` — no IDs to copy back.

If you get a 4xx error here, your account may need Workers Paid for queues.
Check the response: if it mentions "Queues requires Workers Paid", you can
either upgrade ($5/month) or replace the queue with a direct
`await runFn(ctx, params)` call. Most users on a fresh account get queues
on the free plan.

---

## 6. Create the R2 bucket (optional but recommended)

R2 stores verbose run logs — the per-step log you see on the run detail
page. Without it, runs still complete but the log shows up empty after
the queue consumer finishes. Free plan: 10GB storage, 1M class-A
operations/month.

To enable R2, first toggle it on at <https://dash.cloudflare.com/> → R2
(click "Enable R2"). Then:

```bash
npx wrangler r2 bucket create ops-dashboard-logs
```

If you skip this step, comment out the `[[r2_buckets]]` block in
`wrangler.toml` to suppress deploy warnings.

---

## 7. Set up Cloudflare Access (auth)

Cloudflare Access is a zero-trust auth layer in front of your worker. It
handles Google/GitHub/email SSO without you writing auth code.

### 7a. Enable Zero Trust

Go to <https://one.dash.cloudflare.com/> and create a Zero Trust account.
Pick a team name — that becomes your `CF_TEAM_DOMAIN`. Example: if you
pick `acme`, your team domain is `acme.cloudflareaccess.com`.

Update `wrangler.toml`:

```toml
CF_TEAM_DOMAIN = "acme"
```

### 7b. Add an identity provider

In the Zero Trust dashboard → Settings → Authentication → Login methods,
add at least one identity provider:

- **One-time PIN**: simplest, lets anyone with an authorized email log in
  via a code emailed to them.
- **Google / GitHub / Microsoft / etc.**: more polished SSO. Each takes
  a few minutes to wire up.

### 7c. Create an Access application

Zero Trust → Access → Applications → Add an application → **Self-hosted**.

- **Application name**: `Ops Dashboard`
- **Session duration**: 24 hours is reasonable
- **Application domain**: `ops.example.com` (the domain you'll deploy to;
  must match `APP_DOMAIN`)
- Click Next.
- **Policies**: add at least one policy with the rule `Emails: <your email>`
  and action `Allow`. Add additional emails or use the `Email domain` rule
  for everyone at your company.

After saving, the application page shows an **Application Audience (AUD) tag**
— a 64-char hex string. Copy it; you'll set it as a worker secret next.

### 7d. Set the worker secrets

The worker needs the Access AUD tag (to verify Access JWTs) and a master
encryption key (to encrypt API tokens at rest):

```bash
# Access AUD tag from step 7c.
npx wrangler secret put CF_ACCESS_AUD
# (paste the 64-char hex string when prompted)

# Generate a fresh 32-byte AES-GCM master key.
openssl rand -base64 32 | npx wrangler secret put OPS_SECRETS_MASTER_KEY
```

**The master key is not recoverable** — if you lose it, every encrypted
secret in D1 becomes unreadable. Store it somewhere you trust (1Password,
your password manager, an offline backup) before moving on.

---

## 8. Deploy

```bash
npm run deploy
```

You should see something like:

```
Uploaded ops-dashboard (4.2s)
Deployed ops-dashboard triggers (2.1s)
  https://ops-dashboard.<your-subdomain>.workers.dev
  schedule: */1 5-23 * * *
  Producer for ops-dashboard-dispatch
  Consumer for ops-dashboard-dispatch
Current Version ID: <uuid>
```

If you see an error about a missing Durable Object class, double-check
that the `[[migrations]]` block in `wrangler.toml` has all three classes:
`WorkflowLock`, `UsageCounter`, `WebhookDedup`. The platform refuses to
register new SQLite-backed DOs without a migration entry.

---

## 9. Add a custom domain (the one that matches `APP_DOMAIN`)

Cloudflare → Workers & Pages → your worker → Settings → Triggers → Custom
Domains → Add Custom Domain.

Enter the same domain you put in `APP_DOMAIN` (e.g. `ops.example.com`).
Cloudflare DNS records are added automatically if the zone is in your
account.

This step is required for Cloudflare Access to gate the worker — the
`*.workers.dev` URL isn't covered by Access.

---

## 10. Seed the example workflows into D1

The platform reads the scripts list from D1, not from disk. Until a row
exists for each script, the dashboard is empty.

```bash
# Hello world
npx wrangler d1 execute ops-dashboard --remote --command "$(cat <<'SQL'
INSERT OR IGNORE INTO scripts (id, name, description, runtime, enabled, metadata, created_at, updated_at) VALUES (
  'hello-world',
  'Hello World',
  'Smallest possible workflow. Logs a greeting.',
  'worker',
  1,
  '{"runtime":"worker","triggers":[{"type":"cron","enabled":true},{"type":"manual","enabled":true}],"required_secrets":[],"params_schema":[{"key":"dry_run","label":"Dry run","type":"boolean","default":true,"description":"No-op for hello-world."},{"key":"name","label":"Name to greet","type":"string","default":"world","description":"Demo string param."}]}',
  datetime('now'), datetime('now')
);
INSERT OR IGNORE INTO schedules (script_id, cron_expression, timezone, business_hours_only, next_run_at, updated_at)
VALUES ('hello-world', '0 9 * * 1-5', 'UTC', 0, datetime('now'), datetime('now'));
SQL
)"

# Webhook echo
npx wrangler d1 execute ops-dashboard --remote --command "$(cat <<'SQL'
INSERT OR IGNORE INTO scripts (id, name, description, runtime, enabled, metadata, created_at, updated_at) VALUES (
  'webhook-echo',
  'Webhook Echo',
  'Receives a webhook at /webhooks/echo/ping and logs the payload.',
  'worker',
  1,
  '{"runtime":"worker","triggers":[{"type":"webhook","service":"echo","event":"ping","enabled":true},{"type":"manual","enabled":true}],"required_secrets":["echo_webhook_secret"],"params_schema":[]}',
  datetime('now'), datetime('now')
);
SQL
)"

# Paginated sync example (disabled — it's a template, not runnable as-is)
npx wrangler d1 execute ops-dashboard --remote --command "$(cat <<'SQL'
INSERT OR IGNORE INTO scripts (id, name, description, runtime, enabled, metadata, created_at, updated_at) VALUES (
  'paginated-sync-example',
  'Paginated Sync (Example)',
  'Template for cross-API sync with cursor and subrequest budgeting. Will not run as-is.',
  'worker',
  0,
  '{"runtime":"worker","triggers":[{"type":"cron","enabled":false},{"type":"manual","enabled":true}],"required_secrets":["source_api_token","destination_api_token"],"params_schema":[{"key":"dry_run","label":"Dry run","type":"boolean","default":true,"description":"Read-only mode."},{"key":"reset","label":"Reset cursor","type":"boolean","default":false,"description":"Start over."},{"key":"batch_size","label":"Items per run","type":"number","default":40,"description":"Capped at 40 for the 50-subrequest budget."}]}',
  datetime('now'), datetime('now')
);
SQL
)"
```

Refresh the dashboard at `https://<your-domain>/`. Three cards should
appear.

---

## 11. Smoke test

1. On the dashboard, click **Run now** on `Hello World`. Leave dry_run on.
2. The card should briefly show "running" then "success" within 5 seconds.
3. Click **Details** → click the run row. The verbose log should show:
   ```
   [INFO] Starting workflow: Hello World
   [INFO] Running worker script: hello-world
   [INFO] Hello, world! (dry_run=true)
   [SUCCESS] Done.
   [SUCCESS] Workflow completed successfully
   ```

If the run never completes, see [docs/gotchas.md](gotchas.md) → "Run stuck
at 'running'".

---

## 12. Optional: add a Resend API key (for failure emails)

Without Resend wired up, failed runs are still logged in D1 — you just
won't be notified by email.

1. Sign up at <https://resend.com> and verify your sending domain (the
   one you set in `RESEND_FROM_EMAIL`). This requires DNS records on the
   sending domain.
2. In Resend → API Keys → Create API Key, name it "Ops Dashboard", select
   "Sending access" restricted to your verified domain. Copy the key
   (starts with `re_`).
3. Save it to the worker:

   ```bash
   npx wrangler secret put RESEND_API_KEY
   # paste the re_... value
   ```

4. Open `https://<your-domain>/settings/notifications`, add yourself as a
   recipient.

---

## 13. Optional: add a GitHub PAT (for the paste-back deploy flow)

The Edit modal on each workflow lets an LLM produce a "paste-back" envelope
that the worker uses to open a PR against your repo. Skip this if you'll
edit scripts directly via `git push`.

1. Go to <https://github.com/settings/tokens?type=beta> and create a
   fine-grained PAT.
2. **Resource owner**: your account or org. **Repository access**: select
   only your `ops-dashboard` fork.
3. **Permissions**:
   - Contents: Read and write
   - Pull requests: Read and write
   - Actions: Read and write (if you'll use external-runtime scripts)
4. Copy the token (starts with `github_pat_`).
5. `npx wrangler secret put GITHUB_PAT` and paste it.

---

## You're done

The dashboard is live at your custom domain, gated by Cloudflare Access,
with three example workflows.

Next:

- **Delete the examples or keep them as a heartbeat.** `hello-world` is
  useful as a "is the platform alive?" canary; the other two can go.
- **Add your real automations.** See [adding-scripts.md](adding-scripts.md).
- **Add the API keys you'll need.** See [api-keys.md](api-keys.md).
- **Skim the gotchas.** [gotchas.md](gotchas.md) — 5-minute read, will save
  you a 2-hour debug session at some point.
