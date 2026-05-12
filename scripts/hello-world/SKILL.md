# Hello World

The smallest possible workflow. Logs a greeting, then exits.

## Purpose

Use it once after setup to confirm the platform is wired up correctly:

- The script is in the registry.
- The D1 `scripts` row exists.
- The cron is firing (if scheduled).
- The Settings UI sees it.
- The "Run now" button enqueues to the dispatch queue and the queue consumer
  picks it up.
- The run row goes from `running` → `success`.
- The log shows up on the run detail page.

If "Hello World" runs cleanly, the platform is healthy. Then delete it
(or leave it as a heartbeat).

## Schedule

Default: `0 9 * * 1-5` — every weekday at 9 AM UTC. Adjust or disable in
Settings.

## Params

- `dry_run` (boolean, default `true`) — has no effect for hello-world (it
  never has side effects), but is included so the param-passing UI can be
  demonstrated.
- `name` (string, default `"world"`) — the name to greet.

## Failure modes

None expected. If this fails, something is fundamentally wrong with the
platform (queue consumer crashed, D1 inaccessible, etc.). Check the
worker logs in the Cloudflare dashboard.
