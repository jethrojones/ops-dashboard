# Ops Dashboard

A self-hosted ops console on Cloudflare Workers. Schedule and run automations,
manage encrypted API keys, watch failures via email, and let an LLM patch
broken scripts via paste-back PRs.

Built for the case where you want **Zapier-style "set it and forget it"
automations** but you also want to own the code, the runtime, and the budget.

- **Free to run for solo / small-team use** — fits comfortably inside
  Cloudflare's free tier (100k worker requests/day, 100k D1 writes/day,
  1k KV writes/day, 10k queue ops/day, 1M R2 ops/month).
- **Each automation is just a TypeScript function** — no DSL, no YAML, no
  vendor lock-in.
- **Single-tenant** — designed for you (or your small team) to run inside
  Cloudflare Access SSO. Not a SaaS.

## What's in the box

| Feature                                    | Where it lives                                         |
|--------------------------------------------|--------------------------------------------------------|
| Cron scheduler (per-minute tick)           | `src/index.ts` → `runScheduler()`                      |
| Queue-based job dispatch with retries      | Cloudflare Queues + `src/index.ts` → `handleQueue()`   |
| Stale-run sweeper (catches CPU-time kills) | `src/index.ts` → `sweepStaleRuns()`                    |
| Per-workflow lock (no double-runs)         | `src/objects/WorkflowLock.ts`                          |
| Webhook deduplication                      | `src/objects/WebhookDedup.ts`                          |
| Daily usage counters + circuit breaker     | `src/objects/UsageCounter.ts`, `src/lib/usage.ts`      |
| AES-GCM encrypted secret storage in D1     | `src/lib/crypto.ts`, `src/api/secrets.ts`              |
| Cloudflare Access JWT verification         | `src/api/auth.ts`                                      |
| Server-rendered HTML UI (no JS framework)  | `src/frontend/*`                                       |
| Failure emails via Resend                  | `src/lib/resend.ts`                                    |
| "Copy for Claude" debug payload            | `src/api/runs.ts`, `src/lib/payload.ts`                |
| Paste-back deploy via GitHub PRs           | `src/api/deploy.ts`, `src/lib/containment.ts`          |
| Live connection health checks              | `src/api/secrets.ts` → `testServiceCredential()`       |
| Run log retention in R2 (optional)         | `src/index.ts` → `handleQueue` → `LOGS.put()`          |

## Quick start

```bash
git clone https://github.com/jethrojones/ops-dashboard.git
cd ops-dashboard
npm install
cp wrangler.toml.example wrangler.toml
# Fill in your Cloudflare account ID + create resources (see docs/cloudflare-setup.md)
npm run db:migrate
npx wrangler secret put OPS_SECRETS_MASTER_KEY
npx wrangler secret put CF_ACCESS_AUD
npm run deploy
```

Then visit `https://<your-domain>` — Cloudflare Access prompts you to sign in.
You should see the dashboard with the three example workflows.

If you got lost in the quick start, read **docs/cloudflare-setup.md** for the
zero-to-running walkthrough.

## Design system

The UI ships with the **Glassline** palette: fog-grey neutrals with one
cobalt accent. The full spec is in [`docs/design.md`](docs/design.md). To
swap palettes, edit the six color tokens in `src/frontend/styles.ts` —
everything else is derived.

## Documentation

- **[docs/cloudflare-setup.md](docs/cloudflare-setup.md)** — Zero to deployed
  in 30 minutes. Cloudflare account, D1, R2, KV, queues, Access. **Start here.**
- **[docs/architecture.md](docs/architecture.md)** — How the pieces fit. Run
  lifecycle, durability guarantees, where each request goes.
- **[docs/adding-scripts.md](docs/adding-scripts.md)** — The 10-step process
  for adding a new automation. Worth bookmarking; LLMs miss steps without it.
- **[docs/api-keys.md](docs/api-keys.md)** — Where to get API keys from the
  most common services (HubSpot, Resend, GitHub, Stripe, etc.), with the exact
  scopes/permissions to set.
- **[docs/services-without-apis.md](docs/services-without-apis.md)** — What
  to do when there's no official API: scraping patterns, headless browsers,
  hidden internal APIs.
- **[docs/gotchas.md](docs/gotchas.md)** — Subrequest limits, CPU-time kills,
  cron windows, the things that bit us in production.
- **[docs/design.md](docs/design.md)** — The Glassline design spec — tokens,
  typography, do's and don'ts.

## Building this from scratch with an LLM

If you'd rather have an LLM build the dashboard for you instead of cloning
this repo:

1. Tell it: *"Read README.md, docs/cloudflare-setup.md, and docs/architecture.md
   in this repo. Then build the same thing from scratch in `~/my-ops-dashboard`,
   matching the architecture and the file layout. Do not copy code blindly —
   read it and re-implement. Don't include any specific service integrations
   until I ask for them."*
2. After it scaffolds, run `npm run typecheck` and `npm run deploy`.
3. Iterate. The dashboard is small enough (~3,000 LOC of platform code) that
   an LLM can hold most of it in context.

The flip side: **just cloning is faster and less risky.** The architecture
has a few load-bearing details (lock acquisition order, the stale-run
sweeper, the AES-GCM encrypted blob format) that are easy to miss.

## Adding your own automations

```bash
# In your terminal, from the repo root:
npx claude  # or your favorite LLM CLI

# Then ask:
# "Add a workflow that syncs new HubSpot deals into Notion every weekday at 9am."
```

If you have Claude Code installed, the project ships a `.claude/skills/ops-add-script/`
skill that walks the LLM through the full 10-step setup so it doesn't miss
the D1 INSERT or the schedules row (the two most common LLM bugs).

By hand: see [`docs/adding-scripts.md`](docs/adding-scripts.md).

## What this isn't

- **Not a multi-tenant SaaS.** One Cloudflare account, one Access policy,
  one deployment.
- **Not real-time.** Cron resolution is 1 minute. Webhook latency is queue
  delivery + cold start (~1–3s typical).
- **Not durable for long-running workloads.** Each script run gets a
  Workers CPU budget (30s free, 5min paid). For pipelines beyond that, use
  Cloudflare Workflows or a different platform.
- **Not isolated between scripts.** Every script can read every secret. If
  you need tenant isolation, this is the wrong template.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

Patches welcome. Before submitting:

```bash
npm run typecheck
npm run test
```

The platform code (`src/`) tries to stay small and predictable. The
`scripts/` examples are deliberately stripped-down — feel free to delete
them once you're up and running.
