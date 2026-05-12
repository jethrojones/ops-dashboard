# Gotchas

Things that bit us in production. Skim this once before deploying — most
of it will save you a 2-hour debug session at some point.

---

## 1. The 50-subrequest cap

Workers Free plan: **each invocation can make at most 50 fetch
subrequests.** D1 reads and KV reads don't count (they're bindings, not
fetches). Workers Paid raises this to 1000.

What blows it up: looping with multiple fetches per iteration.

```ts
// Bad — 4 fetches × 50 items = 200 subrequests = blown
for (const item of items) {
  const a = await fetch(`https://api/a/${item.id}`);
  const b = await fetch(`https://api/b/${item.id}`);
  const c = await fetch(`https://api/c/${item.id}`);
  await fetch(`https://api/update`, { method: 'PUT', body: ... });
}
```

```ts
// Good — pre-fetch in a batch endpoint if the API offers one
const all = await fetch(`https://api/batch?ids=${ids.join(',')}`);
// then process in memory, single PUT at the end
```

When you can't avoid fan-out, cap with `batch_size` ≤ 40 (leaves 10
subrequests of margin):

```ts
const batchSize = Math.min(params?.batch_size ?? 40, 40);
```

See `scripts/paginated-sync-example/script.ts` for the full pattern.

**Symptom**: `Workflow failed: Too many subrequests by single Worker invocation.`

---

## 2. CPU-time kills silently bypass `try/catch`

Cloudflare kills worker invocations that exceed the CPU budget (30s Free,
5min Paid). The kill happens at the platform level — JS exception
handlers don't fire. Result: the queue consumer's `catch` block doesn't
run, so:

- The `runs` row stays at `status='running'`.
- The `WorkflowLock` stays held.
- No failure email goes out.
- Every subsequent cron tick checks the lock, finds it taken, **silently
  skips**. The workflow is effectively disabled.

**The platform recovers from this automatically** via `sweepStaleRuns()`,
which runs every minute alongside the scheduler. Any run >15 minutes old
in `'running'` is marked failed, its lock released, and a failure email
sent.

You'll occasionally see a run in the UI marked failed by the sweeper
with the error category `unknown` and the summary "Run did not complete
within 15 minutes". That's usually a CPU-time kill.

**Symptom**: a workflow that was working stops running for hours/days,
no failure emails. Solution: it's almost always the sweeper recovering;
check the failed runs for the sweeper's tell-tale summary.

---

## 3. The dashboard reads scripts from D1, not from disk

The scripts list comes from the `scripts` D1 table, not the
`scripts/<id>/` folders. If you add a script file and register it but
forget to INSERT the D1 row, the dashboard is empty. The script also
won't run on cron because there's no `schedules` row either.

Step 6 of [adding-scripts.md](adding-scripts.md) is the INSERT. Don't
skip it.

**Symptom**: new script doesn't appear after deploy. Solution: check
`SELECT id FROM scripts;` in D1 for your script's id.

---

## 4. `next_run_at` NULL = the cron never fires

The scheduler query is:

```sql
SELECT ... FROM scripts JOIN schedules ON ...
WHERE enabled = 1
  AND next_run_at IS NOT NULL    -- ← this filter
  AND next_run_at <= ?
```

If you INSERT a `schedules` row with `next_run_at = NULL`, the scheduler
ignores it forever. Always set `next_run_at = datetime('now')` (or some
future timestamp).

The Edit Schedule UI in the dashboard handles this correctly. The risk
is when you `INSERT` manually.

---

## 5. The worker's own cron window

`wrangler.toml`:

```toml
[triggers]
crons = ["*/1 5-23 * * *"]
```

This is when **the scheduler itself runs**, not the schedule of your
scripts. The default fires every minute, 5:00-23:59 UTC. If your script's
cron fires at 03:00 UTC, the scheduler isn't running, so nothing
notices the workflow is due. It'll fire at 05:00 UTC instead, delayed.

For 24-hour coverage: `crons = ["*/1 * * * *"]`. Trade-off: 24-hour
coverage = 1,440 cron ticks/day, each one a worker request against your
100k/day budget. Still 2% — fine.

---

## 6. D1 has a 50-statement-per-invocation cap

Not subrequests, but D1 statements. Don't iterate INSERTs in a loop:

```ts
// Bad
for (const item of items) await env.DB.prepare('INSERT ...').bind(...).run();

// Good
const stmt = env.DB.prepare('INSERT ...');
await env.DB.batch(items.map(i => stmt.bind(...)));
```

`batch()` counts as 1 statement. Most one-script-per-invocation patterns
stay well under, but watch out in cleanup loops.

---

## 7. KV writes are 1k/day on the free plan

KV is for *caching*, not for state. Don't write to KV on every request.
If you find yourself doing that, move it to a Durable Object (see
`src/objects/UsageCounter.ts` for the pattern — D1 inside a DO is
unmetered).

Reads from KV are cheap (10M/day free). Writes are the cap.

---

## 8. Durable Objects need a migration entry on first deploy

If you add a new SQLite-backed Durable Object class, you **must** also
add it to `wrangler.toml`:

```toml
[[migrations]]
tag = "v1"                                  # bump on next migration
new_sqlite_classes = ["NewDOClass", ...]
```

Without this, deploy fails or the binding silently doesn't work. The
template's `wrangler.toml.example` already lists all three current DOs;
extend the array when you add more.

---

## 9. Cloudflare Access tokens expire

Auth uses Cloudflare Access. By default Access sessions last 24h
(configurable per-app in the Zero Trust dashboard). After expiry, the
JWT in the `Cf-Access-Jwt-Assertion` header is rejected by
`requireAuth()` and you'll see "Unauthorized" pages.

If users complain about "I keep getting logged out", bump the session
duration in the Access app settings.

---

## 10. R2 isn't enabled by default

R2 stores verbose run logs. If you haven't enabled R2 on your account
(`dash.cloudflare.com` → R2 → Enable R2 — requires entering payment info
even for the free tier), the binding fails at deploy time.

If you don't want R2:

- Comment out the `[[r2_buckets]]` block in `wrangler.toml`.
- Runs still complete; you just lose verbose log retention. The run row
  in D1 still records status + error_summary.

---

## 11. The `--remote` vs `--local` D1 trap

`wrangler d1 execute ops-dashboard --command "..."` defaults to the **local**
D1 (a SQLite file in `.wrangler/`). To run against the deployed remote
D1, always pass `--remote`:

```bash
npx wrangler d1 execute ops-dashboard --remote --command "..."
```

If you run a migration with `--local`, your deployed worker won't see
the schema change. If you forget `--remote`, you'll be very confused
why your INSERT didn't show up on the dashboard.

---

## 12. Hono routes are order-sensitive

The router matches the first route. Don't put `/workflows/:id` before
`/workflows/:id/edit` — the parameterized route eats the literal one.
The current `src/index.ts` has the order right; if you add new routes,
add the more specific ones first.

---

## 13. The paste-back containment regex doesn't catch everything

`src/lib/containment.ts` flags obvious exfiltration attempts (`eval`,
`process.env`, etc.) but it's not a perfect firewall against a determined
attacker. **Always review the diff in the PR** before merging — the
containment check is a tripwire, not a guarantee.

---

## 14. Resend's "from" address must be on a verified domain

If you set `RESEND_FROM_EMAIL = "ops@example.com"` but haven't verified
the `example.com` domain in Resend, every email send returns 403 and the
failure-email path silently fails. The run row is still updated to
`failed` (the email is best-effort), so you only notice when you check
the dashboard.

Verify the domain in Resend before relying on emails.

---

## 15. `console.log` in scripts is invisible

The verbose log on the run detail page is built from `ctx.log()` calls
only. `console.log` shows up in `wrangler tail` and the Cloudflare
dashboard logs, but not in the UI. Always use `ctx.log` from inside
scripts.

`console.log`/`console.error` is fine in `src/` platform code — those
appear in `wrangler tail` and Cloudflare's logs and aren't meant for
end-user inspection.

---

## 16. The "Copy for Claude" payload includes the source at the failing SHA

It fetches `script.ts` from GitHub at the run's `version_sha`. If you
haven't set `GITHUB_PAT`, fetching private-repo content returns 404 and
the payload falls back to instructing the LLM to read the files from
disk. Public repos work without a PAT.

If you see "Source files could not be fetched from GitHub" in a
Copy-for-Claude payload, you either need a PAT or your repo is private
without one.
