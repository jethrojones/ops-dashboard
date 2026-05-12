import { Hono } from 'hono';
import type { Env, Script, Run, QueueMessage } from './types.js';
import { requireAuth, getUser } from './api/auth.js';
import { workflowsRouter } from './api/workflows.js';
import { deployRouter } from './api/deploy.js';
import { runsRouter } from './api/runs.js';
import { secretsRouter } from './api/secrets.js';
import { settingsRouter, getNotifyEmails } from './api/settings.js';
import { dashboardPage } from './frontend/dashboard.js';
import { workflowDetailPage } from './frontend/workflow.js';
import { runDetailPage } from './frontend/run-detail.js';
import { runsListPage } from './frontend/runs.js';
import { addNewPage } from './frontend/add-new.js';
import { ADD_SCRIPT_SKILL_MD } from './skill-content.js';
import { settingsPage, notificationPreviewPage } from './frontend/settings.js';
import { getSnapshot, increment } from './lib/usage.js';
import { decrypt } from './lib/crypto.js';
import { scriptRegistry } from './script-registry.js';
import { buildScriptEnv, buildLogRedactor } from './queue-consumer.js';
import { computeNextRun } from './lib/cron.js';

// Constant-time string comparison. Doesn't leak the value byte-by-byte via
// timing. Length comparison still leaks length, fine for known-length secrets.
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Re-export Durable Object classes (required by wrangler)
export { WorkflowLock } from './objects/WorkflowLock.js';
export { UsageCounter } from './objects/UsageCounter.js';
export { WebhookDedup } from './objects/WebhookDedup.js';

const app = new Hono<{ Bindings: Env }>();

// ── Usage counter middleware ─────────────────────────────────────────────────
app.use('*', async (c, next) => {
  // Fire-and-forget — don't let this slow down responses
  c.executionCtx?.waitUntil(increment(c.env, 'worker_requests').catch(() => {}));
  await next();
});

// ── Health check — no auth ───────────────────────────────────────────────────
app.get('/healthz', (c) => c.text('OK'));

// ── Webhook receivers — no auth (each verifies its own signature) ────────────
//
// Generic shared-secret webhook endpoint: /webhooks/:service/:event
//
// Convention: store the per-service shared secret in Settings → Connections
// under the key `<service>_webhook_secret`. The endpoint reads the
// `X-Webhook-Secret` request header and compares.
//
// To add a service:
// 1. Add a connection entry in Settings → Connections.
// 2. Add a `webhook` trigger in your script's metadata.json:
//      { "type": "webhook", "service": "<service>", "event": "<event>", "enabled": true }
// 3. Point the third-party webhook at https://<your-domain>/webhooks/<service>/<event>
//    and set the `X-Webhook-Secret` header to the stored value.
//
// For providers that use HMAC instead (HubSpot, Stripe, GitHub, etc.),
// add a dedicated handler above this one with the correct verification.
app.post('/webhooks/:service/:event', async (c) => {
  const event = c.req.param('event');
  const env = c.env;

  const service = c.req.param('service');
  // Verify shared secret stored under `<service>_webhook_secret`.
  const headerSecret = c.req.header('X-Webhook-Secret') ?? '';
  let expectedSecret = '';
  try {
    const row = await env.DB.prepare('SELECT encrypted_blob FROM secrets WHERE service = ?')
      .bind(`${service}_webhook_secret`)
      .first<{ encrypted_blob: string }>();
    if (row) expectedSecret = await decrypt(row.encrypted_blob, env.OPS_SECRETS_MASTER_KEY);
  } catch { /* if we can't verify, reject */ }

  if (!expectedSecret || !constantTimeEquals(headerSecret, expectedSecret)) {
    return c.json({ error: 'Invalid webhook secret' }, 401);
  }

  const payload = await c.req.json<unknown>().catch(() => ({}));
  return enqueueWebhook(env, service, event, payload, undefined);
});

// ── GitHub Actions callback ──────────────────────────────────────────────────
// Used by external-runtime scripts that run as GitHub Actions jobs. The Action
// hits this endpoint with the run's outcome. Auth is by a shared secret stored
// as the worker's CALLBACK_AUTH_SECRET (must also be set in the Action as a
// repo secret and forwarded as an X-Callback-Secret header).
//
// run_id is a UUID, but UUIDs aren't durable secrets — they show up in URLs,
// logs, and the Copy-for-Claude payload — so they aren't enough on their own.
const MAX_LOG_OUTPUT_BYTES = 100_000;
app.post('/api/webhook/github-callback', async (c) => {
  const env = c.env;

  // Verify the shared secret. Fail closed if it isn't configured at all.
  const callbackSecret = env.CALLBACK_AUTH_SECRET ?? '';
  if (!callbackSecret) {
    return c.json({ error: 'Callback endpoint not configured' }, 503);
  }
  const provided = c.req.header('X-Callback-Secret') ?? '';
  if (!provided || !constantTimeEquals(provided, callbackSecret)) {
    return c.json({ error: 'Invalid callback secret' }, 401);
  }

  const body = await c.req.json<{
    run_id: string;
    status: string;
    github_run_url: string;
    log_output: string;
  }>().catch(() => null);
  if (!body?.run_id) return c.json({ error: 'Missing run_id' }, 400);

  // Cap log_output to keep R2 writes bounded.
  if (typeof body.log_output === 'string' && body.log_output.length > MAX_LOG_OUTPUT_BYTES) {
    body.log_output = body.log_output.slice(-MAX_LOG_OUTPUT_BYTES) + '\n…[truncated]';
  }

  const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(body.run_id).first<{ id: string; log_r2_key: string | null; status: string }>();
  if (!run) return c.json({ error: 'Run not found' }, 404);

  // Reject callbacks for runs already in a terminal state — prevents replay
  // attacks that flip a successful run to failed (or vice versa) later.
  if (run.status === 'success' || run.status === 'failed') {
    return c.json({ error: 'Run is already in a terminal state', status: run.status }, 409);
  }

  const ghStatus = body.status === 'success' ? 'success' : 'failed';
  const now = new Date().toISOString();

  // Update run status to reflect actual GitHub outcome
  await env.DB.prepare(
    `UPDATE runs SET status=?, ended_at=COALESCE(ended_at,?), github_run_url=?, error_summary=? WHERE id=?`
  ).bind(
    ghStatus,
    now,
    body.github_run_url,
    ghStatus === 'failed' ? (body.log_output.slice(-500) || 'GitHub Actions job failed') : null,
    body.run_id,
  ).run();

  // Append GitHub output to the existing R2 log
  if (env.LOGS && run.log_r2_key) {
    const existing = await env.LOGS.get(run.log_r2_key);
    const log = existing ? await existing.json<{ steps: unknown[] }>().catch(() => ({ steps: [] })) : { steps: [] };
    log.steps.push({
      seq: (log.steps.length),
      ts: now,
      type: ghStatus === 'success' ? 'success' : 'error',
      message: ghStatus === 'success' ? 'GitHub Actions job completed successfully' : 'GitHub Actions job failed',
      detail: { github_run_url: body.github_run_url, output: body.log_output },
    });
    await env.LOGS.put(run.log_r2_key, JSON.stringify(log), { httpMetadata: { contentType: 'application/json' } });
  }

  return c.json({ ok: true });
});

// ── Origin check middleware for state-changing API routes ────────────────────
// Belt-and-braces against cross-origin form submissions exploiting an active
// Cloudflare Access session. Same-site cookies and CORS preflight already
// block most flows; this is a hard backstop. We check on POST/PUT/DELETE/PATCH
// to `/api/*`; reads (GET) and webhook endpoints are unaffected.
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
    const origin = c.req.header('Origin') ?? '';
    if (origin) {
      const expected = `https://${c.env.APP_DOMAIN}`;
      if (origin !== expected) {
        return c.json({ error: 'Origin mismatch' }, 403);
      }
    }
    // Origin can be absent for non-browser clients (curl, scripts).
    // Cloudflare Access still gates the call, so we allow it through.
  }
  await next();
  return;
});

// ── Auth middleware for all other routes ─────────────────────────────────────
app.use('/api/*', async (c, next) => requireAuth(c.env)(c, next));
app.use('/workflows/*', async (c, next) => requireAuth(c.env)(c, next));
app.use('/settings/*', async (c, next) => requireAuth(c.env)(c, next));
app.get('/', async (c, next) => requireAuth(c.env)(c, next));
app.get('/runs', async (c, next) => requireAuth(c.env)(c, next));
app.get('/add-new', async (c, next) => requireAuth(c.env)(c, next));
app.use('/add-new/*', async (c, next) => requireAuth(c.env)(c, next));

// ── API routers ──────────────────────────────────────────────────────────────
app.route('/api/workflows', workflowsRouter);
app.route('/api/workflows', deployRouter);
app.route('/api/runs', runsRouter);
app.route('/api/secrets', secretsRouter);
app.route('/api/settings', settingsRouter);

// ── HTML page routes ─────────────────────────────────────────────────────────

// Dashboard
app.get('/', async (c) => {
  const env = c.env;
  const user = getUser(c);

  const [scriptsResult, runsResult, usage] = await Promise.all([
    env.DB.prepare(`
      SELECT s.*, sc.next_run_at
      FROM scripts s
      LEFT JOIN schedules sc ON sc.script_id = s.id
      ORDER BY s.name
    `).all<Script & { next_run_at?: string | null }>(),
    env.DB.prepare(`
      SELECT r.*, s.name as script_name
      FROM runs r
      JOIN scripts s ON s.id = r.script_id
      ORDER BY r.started_at DESC
      LIMIT 25
    `).all<Run & { script_name: string }>(),
    getSnapshot(env),
  ]);

  const scripts = scriptsResult.results ?? [];

  // Attach last_run to each script
  const runsAll = runsResult.results ?? [];
  const lastRunMap = new Map<string, Run>();
  for (const run of [...runsAll].reverse()) {
    lastRunMap.set(run.script_id, run);
  }
  const scriptsWithRuns = scripts.map(s => ({
    ...s,
    metadata: parseMetadata(s.metadata),
    last_run: lastRunMap.get(s.id),
  }));

  return c.html(dashboardPage({
    scripts: scriptsWithRuns,
    recentRuns: runsAll,
    usage,
    userEmail: user.email,
  }));
});

// Add-new — onboarding/skill page
app.get('/add-new', (c) => {
  const user = getUser(c);
  return c.html(addNewPage({ userEmail: user.email }));
});

// Skill download endpoint
app.get('/add-new/skill.md', () =>
  new Response(ADD_SCRIPT_SKILL_MD, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="SKILL.md"',
    },
  })
);

// Runs list — search/filter across all workflows
app.get('/runs', async (c) => {
  const env = c.env;
  const user = getUser(c);

  const q = (c.req.query('q') ?? '').trim();
  const status = (c.req.query('status') ?? '').trim();
  const since = (c.req.query('since') ?? '').trim();   // YYYY-MM-DD
  const until = (c.req.query('until') ?? '').trim();   // YYYY-MM-DD
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const perPage = 50;
  const offset = (page - 1) * perPage;

  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (q) { where.push('s.name LIKE ?'); binds.push(`%${q}%`); }
  if (status) { where.push('r.status = ?'); binds.push(status); }
  if (since) { where.push('r.started_at >= ?'); binds.push(`${since}T00:00:00.000Z`); }
  if (until) { where.push('r.started_at <= ?'); binds.push(`${until}T23:59:59.999Z`); }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [totalRow, runsResult] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) as cnt
      FROM runs r
      JOIN scripts s ON s.id = r.script_id
      ${whereClause}
    `).bind(...binds).first<{ cnt: number }>(),
    env.DB.prepare(`
      SELECT r.*, s.name as script_name
      FROM runs r
      JOIN scripts s ON s.id = r.script_id
      ${whereClause}
      ORDER BY r.started_at DESC
      LIMIT ? OFFSET ?
    `).bind(...binds, perPage, offset).all<Run & { script_name: string }>(),
  ]);

  return c.html(runsListPage({
    runs: runsResult.results ?? [],
    total: totalRow?.cnt ?? 0,
    page,
    perPage,
    filters: { q, status, since, until },
    userEmail: user.email,
  }));
});

// Workflow detail
app.get('/workflows/:id', async (c) => {
  const env = c.env;
  const { id } = c.req.param();
  const user = getUser(c);
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const statusFilter = c.req.query('status') ?? '';

  const script = await env.DB.prepare(`
    SELECT s.*, sc.cron_expression, sc.next_run_at, sc.timezone, sc.business_hours_only, sc.updated_at as sched_updated_at
    FROM scripts s
    LEFT JOIN schedules sc ON sc.script_id = s.id
    WHERE s.id = ?
  `).bind(id).first<Script & {
    cron_expression?: string | null;
    next_run_at?: string | null;
    timezone?: string | null;
    business_hours_only?: number | null;
    sched_updated_at?: string | null;
  }>();

  if (!script) return c.notFound();

  const metadata = parseMetadata(script.metadata);

  let runsSql = 'SELECT * FROM runs WHERE script_id = ?';
  const runsBinds: (string | number)[] = [id];
  if (statusFilter) {
    runsSql += ' AND status = ?';
    runsBinds.push(statusFilter);
  }
  const limit = 20;
  const offset = (page - 1) * limit;

  const [totalRow, runsResult] = await Promise.all([
    env.DB.prepare(runsSql.replace('SELECT *', 'SELECT COUNT(*) as cnt')).bind(...runsBinds).first<{ cnt: number }>(),
    env.DB.prepare(runsSql + ' ORDER BY started_at DESC LIMIT ? OFFSET ?').bind(...runsBinds, limit, offset).all<Run>(),
  ]);

  const schedule = script.cron_expression ? {
    script_id: id,
    cron_expression: script.cron_expression,
    next_run_at: script.next_run_at ?? null,
    timezone: script.timezone ?? 'UTC',
    business_hours_only: !!script.business_hours_only,
    updated_at: script.sched_updated_at ?? script.updated_at,
  } : undefined;

  return c.html(workflowDetailPage({
    script: { ...script, metadata, schedule },
    runs: runsResult.results ?? [],
    page,
    totalRuns: totalRow?.cnt ?? 0,
    userEmail: user.email,
  }));
});

// Run detail
app.get('/workflows/:id/runs/:runId', async (c) => {
  const env = c.env;
  const { id, runId } = c.req.param();
  const user = getUser(c);

  const [script, run] = await Promise.all([
    env.DB.prepare('SELECT * FROM scripts WHERE id = ?').bind(id).first<Script>(),
    env.DB.prepare('SELECT * FROM runs WHERE id = ? AND script_id = ?').bind(runId, id).first<Run>(),
  ]);

  if (!script || !run) return c.notFound();

  return c.html(runDetailPage({
    script: { ...script, metadata: parseMetadata(script.metadata) },
    run,
    appDomain: env.APP_DOMAIN,
    githubOwner: env.GITHUB_REPO_OWNER,
    githubRepo: env.GITHUB_REPO_NAME,
    userEmail: user.email,
  }));
});

// Edit workflow page — returns edit payload modal
app.get('/workflows/:id/edit', async (c) => {
  const env = c.env;
  const { id } = c.req.param();
  const user = getUser(c);

  const script = await env.DB.prepare('SELECT * FROM scripts WHERE id = ?').bind(id).first<Script>();
  if (!script) return c.notFound();

  // Fetch edit payload
  const recentRuns = await env.DB.prepare(
    'SELECT * FROM runs WHERE script_id = ? ORDER BY started_at DESC LIMIT 5'
  ).bind(id).all<Run>();

  const sourceFiles = await fetchScriptFiles(env, id, script.version_sha ?? 'main');
  const { buildEditPayload } = await import('./lib/payload.js');
  const payload = buildEditPayload(
    { ...script, metadata: parseMetadata(script.metadata) },
    recentRuns.results ?? [],
    sourceFiles,
  );

  const escLocal = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Edit ${escLocal(script.name)} — Ops Dashboard</title>
<style>
body { font-family: system-ui, sans-serif; background: #F1F3F5; color: #0F1419; margin: 0; padding: 32px; }
.container { max-width: 900px; margin: 0 auto; }
h1 { font-size: 24px; margin-bottom: 8px; }
p { color: #4A5568; font-size: 14px; margin-bottom: 24px; }
textarea { width: 100%; height: 60vh; font-family: monospace; font-size: 13px; border: 1.5px solid #E5E7EB; border-radius: 8px; padding: 16px; background: #fff; }
.btn { display: inline-flex; align-items: center; padding: 10px 22px; border-radius: 999px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; background: #2C5EF5; color: #fff; font-family: inherit; }
.btn-ghost { background: transparent; border: 1.5px solid #E5E7EB; color: #4A5568; }
.actions { display: flex; gap: 12px; margin-top: 16px; }
</style>
</head>
<body>
<div class="container">
  <a href="/workflows/${escLocal(id)}" style="color:#2C5EF5;font-size:14px;text-decoration:none;">&larr; Back to ${escLocal(script.name)}</a>
  <h1 style="margin-top:16px;">Edit ${escLocal(script.name)}</h1>
  <p>Copy this payload and paste it into Claude Code. Claude will read the source, make changes, and return a paste-back response. Paste that response back in the box below.</p>
  <label style="font-size:13px;font-weight:600;color:#4A5568;display:block;margin-bottom:6px;">Edit payload — copy this into Claude</label>
  <textarea id="edit-payload" readonly onclick="this.select()">${escLocal(payload)}</textarea>
  <div class="actions">
    <button class="btn" onclick="copyPayload()">Copy payload</button>
    <a href="/workflows/${escLocal(id)}" class="btn btn-ghost">Cancel</a>
  </div>
  <hr style="margin:32px 0;border:none;border-top:1px solid #E5E7EB;">
  <label style="font-size:13px;font-weight:600;color:#4A5568;display:block;margin-bottom:6px;">Paste Claude's response here</label>
  <textarea id="pasteback-input" placeholder="Paste Claude's entire response here, including the <<<OPS-PASTEBACK v1>>> sentinels..."></textarea>
  <div class="actions" style="margin-top:16px;">
    <button class="btn" onclick="submitPasteback()">Deploy paste-back</button>
  </div>
  <div id="deploy-status" style="margin-top:16px;font-size:14px;"></div>
</div>
<script>
async function copyPayload() {
  const btn = event.target;
  const txt = document.getElementById('edit-payload').value;
  try {
    await navigator.clipboard.writeText(txt);
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy payload', 2000);
  } catch {
    // Fallback: select the textarea so the user can Cmd+C
    const ta = document.getElementById('edit-payload');
    ta.select();
    ta.setSelectionRange(0, 99999);
    btn.textContent = 'Select all — press Cmd+C';
    setTimeout(() => btn.textContent = 'Copy payload', 3000);
  }
}
async function submitPasteback() {
  const raw = document.getElementById('pasteback-input').value.trim();
  const status = document.getElementById('deploy-status');
  if (!raw) {
    status.innerHTML = '<span style="color:#B91C1C;font-weight:600;">Paste the Claude response into the box first.</span>';
    return;
  }
  status.textContent = 'Validating and deploying…';
  const res = await fetch('/api/workflows/${escLocal(id)}/pasteback', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ raw })
  });
  const data = await res.json();
  if (res.ok) {
    status.innerHTML = '<span style="color:#15803D;font-weight:600;">Deploy started! PR #' + data.pr_number + ' — <a href="' + data.pr_url + '" target="_blank">View on GitHub</a></span>';
    status.innerHTML += '<br><span style="font-size:12px;color:#4A5568;">CI checks are running. Merge will happen automatically when checks pass.</span>';
  } else {
    const reason = data.error || "We couldn't deploy this paste. Refresh and try again, or copy a fresh response from Claude.";
    status.innerHTML = '<span style="color:#B91C1C;font-weight:600;">' + escHtml(reason) + '</span>';
  }
}
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
</script>
</body></html>`;

  void user; // auth guard — getUser() verifies the Access JWT
  return c.html(html);
});

// Settings redirect
app.get('/settings', (c) => c.redirect('/settings/connections'));

// Settings notifications preview
app.get('/settings/notifications/preview', async (c) => {
  const user = getUser(c);
  const html = notificationPreviewPage(user.email);
  return c.html(html);
});

// Settings tabs
app.get('/settings/:tab', async (c) => {
  const env = c.env;
  const user = getUser(c);
  const tab = c.req.param('tab') as 'connections' | 'notifications' | 'account';

  if (!['connections', 'notifications', 'account'].includes(tab)) {
    return c.redirect('/settings/connections');
  }

  const [secretsResult, usage, notifyEmails] = await Promise.all([
    env.DB.prepare('SELECT service, last_rotated_at FROM secrets ORDER BY service').all<{ service: string; last_rotated_at: string | null }>(),
    getSnapshot(env),
    getNotifyEmails(env),
  ]);

  return c.html(settingsPage({
    tab,
    secrets: secretsResult.results ?? [],
    usage,
    userEmail: user.email,
    notifyEmails,
  }));
});

// ── Scheduled handler ────────────────────────────────────────────────────────
async function handleScheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runScheduler(env));
}

// Sweeps runs stuck in 'running' state. The catch block in handleQueue can't
// fire on platform-level CPU/wall-clock kills, which leaves the run row at
// 'running' AND the WorkflowLock held — silently disabling the workflow until
// the lock is released. This sweeper runs every minute via the scheduler tick.
async function sweepStaleRuns(env: Env): Promise<void> {
  const STALE_THRESHOLD_MS = 15 * 60 * 1000;
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

  const stale = await env.DB.prepare(`
    SELECT id, script_id, started_at FROM runs
    WHERE status='running' AND started_at < ?
    LIMIT 10
  `).bind(cutoff).all<{ id: string; script_id: string; started_at: string }>();

  const rows = stale.results ?? [];
  if (rows.length === 0) return;

  console.log(`Sweeping ${rows.length} stale run(s)`);
  const { sendFailureEmail } = await import('./lib/resend.js');

  for (const row of rows) {
    const startedAt = new Date(row.started_at).getTime();
    const endedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    const summary = `Run did not complete within ${Math.floor(STALE_THRESHOLD_MS / 60000)} minutes — likely platform timeout or unhandled crash. Marked failed by stale-run sweeper.`;

    // Atomic claim — only proceed if we transitioned the row from 'running'
    const result = await env.DB.prepare(`
      UPDATE runs SET status='failed', ended_at=?, duration_ms=?,
        error_category='unknown', error_summary=?
      WHERE id=? AND status='running'
    `).bind(endedAt, durationMs, summary, row.id).run();

    if (!result.meta.changes) continue;
    await increment(env, 'd1_writes');

    try {
      const lockId = env.WORKFLOW_LOCK.idFromName(row.script_id);
      await env.WORKFLOW_LOCK.get(lockId).fetch('http://do/unlock', {
        method: 'POST',
        body: JSON.stringify({ workflow_id: row.script_id }),
      });
    } catch (err) {
      console.error(`Failed to release lock for ${row.script_id}:`, err);
    }

    try {
      const [script, toEmails] = await Promise.all([
        env.DB.prepare('SELECT name FROM scripts WHERE id = ?').bind(row.script_id).first<{ name: string }>(),
        getNotifyEmails(env),
      ]);
      const resendKey = env.RESEND_API_KEY ?? '';
      if (resendKey && script && toEmails.length > 0) {
        await sendFailureEmail({
          workflowName: script.name,
          workflowId: row.script_id,
          runId: row.id,
          errorCategory: 'unknown',
          errorSummary: summary,
          startedAt: row.started_at,
          durationMs,
          appDomain: env.APP_DOMAIN,
          toEmails,
          fromEmail: env.RESEND_FROM_EMAIL,
          resendApiKey: resendKey,
        });
      }
    } catch (err) {
      console.error(`Failed to send sweeper failure email for ${row.id}:`, err);
    }
  }
}

async function runScheduler(env: Env): Promise<void> {
  const { checkCircuitBreaker } = await import('./lib/usage.js');
  const breaker = await checkCircuitBreaker(env);
  if (breaker.tripped) {
    console.log(`Circuit breaker tripped on ${breaker.resource} at ${breaker.pct}%. Skipping scheduled run.`);
    return;
  }

  await sweepStaleRuns(env);

  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay(); // 0=Sun, 6=Sat
  const inBusinessHours = utcHour >= 10 && utcHour < 23 && utcDay >= 1 && utcDay <= 5;

  const nowIso = now.toISOString();

  const dueRows = await env.DB.prepare(`
    SELECT s.id, s.name, s.runtime, s.metadata,
           sc.cron_expression, sc.business_hours_only
    FROM scripts s
    JOIN schedules sc ON sc.script_id = s.id
    WHERE s.enabled = 1
      AND sc.next_run_at IS NOT NULL
      AND sc.next_run_at <= ?
      AND (sc.business_hours_only = 0 OR ? = 1)
    LIMIT 20
  `).bind(nowIso, inBusinessHours ? 1 : 0).all<{
    id: string; name: string; runtime: string; metadata: string;
    cron_expression: string; business_hours_only: number;
  }>();

  const due = dueRows.results ?? [];
  if (due.length === 0) return;

  await Promise.all(due.map(async (script) => {
    // Check WorkflowLock
    const lockId = env.WORKFLOW_LOCK.idFromName(script.id);
    const lockObj = env.WORKFLOW_LOCK.get(lockId);
    const runId = crypto.randomUUID();
    const lockResp = await lockObj.fetch('http://do/try-lock', {
      method: 'POST',
      body: JSON.stringify({ workflow_id: script.id, run_id: runId }),
    });
    const lockResult = await lockResp.json() as { locked: boolean };
    if (!lockResult.locked) {
      console.log(`Skipping ${script.id} — already locked`);
      return;
    }

    const runTs = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO runs (id, script_id, status, trigger_type, started_at, created_at)
      VALUES (?, ?, 'running', 'cron', ?, ?)
    `).bind(runId, script.id, runTs, runTs).run();

    const message: QueueMessage = {
      type: 'run_workflow',
      script_id: script.id,
      run_id: runId,
      trigger_type: 'cron',
    };
    await env.DISPATCH_QUEUE.send(message);

    // Compute and update next_run_at
    const nextRun = computeNextRun(script.cron_expression);
    await env.DB.prepare(`
      UPDATE schedules SET next_run_at = ? WHERE script_id = ?
    `).bind(nextRun, script.id).run();

    await increment(env, 'd1_writes', 3);
    await increment(env, 'queue_ops');
  }));
}

// ── Queue consumer handler ───────────────────────────────────────────────────
async function handleQueue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
  const { categorizeError } = await import('./lib/payload.js');
  const { sendFailureEmail } = await import('./lib/resend.js');

  for (const message of batch.messages) {
    const msg = message.body;
    let runLog: import('./types.js').RunLog = {
      run_id: msg.run_id,
      script_id: msg.script_id,
      steps: [],
      captured_at: new Date().toISOString(),
    };

    let seq = 0;
    // Initially a passthrough; replaced with a redactor once secrets are loaded.
    let redact: (v: unknown) => unknown = (v) => v;
    function log(type: import('./types.js').LogStep['type'], logMessage: string, detail?: unknown): void {
      runLog.steps.push({
        seq: seq++,
        ts: new Date().toISOString(),
        type,
        message: typeof redact(logMessage) === 'string' ? (redact(logMessage) as string) : logMessage,
        detail: detail !== undefined ? redact(detail) : detail,
      });
    }

    const startTime = Date.now();

    try {
      const script = await env.DB.prepare('SELECT * FROM scripts WHERE id = ?').bind(msg.script_id).first<Script>();
      if (!script) throw new Error(`Script '${msg.script_id}' not found in database`);

      // Load all secrets for this script
      const requiredSecrets: string[] = (parseMetadata(script.metadata)?.required_secrets) ?? [];
      const secrets: Record<string, string> = {};
      for (const svc of requiredSecrets) {
        try {
          const row = await env.DB.prepare('SELECT encrypted_blob FROM secrets WHERE service = ?').bind(svc).first<{ encrypted_blob: string }>();
          if (row) {
            secrets[svc] = await decrypt(row.encrypted_blob, env.OPS_SECRETS_MASTER_KEY);
          }
        } catch (err) {
          log('error', `Could not load secret for service '${svc}': ${(err as Error).message}`);
        }
      }

      // Activate the log redactor now that secret values are known.
      redact = buildLogRedactor(Object.values(secrets));

      const ctx = {
        scriptId: script.id,
        runId: msg.run_id,
        secrets,
        log,
        db: env.DB,
        // Sanitized env — platform secrets are stripped so script code can't
        // decrypt other secrets or impersonate the platform.
        env: buildScriptEnv(env),
      };

      log('info', `Starting workflow: ${script.name}`, { trigger: msg.trigger_type, run_id: msg.run_id });

      if (script.runtime === 'external') {
        // POST to GitHub Actions dispatch
        const githubPat = secrets['github_pat'] ?? '';
        const meta = parseMetadata(script.metadata);
        const workflowId = meta?.github_workflow_id ?? `${script.id}.yml`;

        log('info', `Dispatching external workflow: ${workflowId}`);
        const resp = await fetch(
          `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/workflows/${workflowId}/dispatches`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${githubPat}`,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
              'User-Agent': 'ops-dashboard',
            },
            body: JSON.stringify({ ref: 'main', inputs: msg.payload ?? {} }),
          }
        );
        if (!resp.ok) throw new Error(`GitHub dispatch failed: ${resp.status} ${await resp.text()}`);
        log('success', 'External workflow dispatched to GitHub Actions');
      } else if (script.runtime === 'worker' || script.runtime === 'workflow') {
        log('info', `Running worker script: ${script.id}`);
        const runFn = scriptRegistry[script.id];
        if (!runFn) throw new Error(`Script '${script.id}' is not registered. Add it to src/script-registry.ts.`);
        await runFn(ctx, msg.payload);
        log('success', 'Workflow completed successfully');
      }

      const durationMs = Date.now() - startTime;
      const endedAt = new Date().toISOString();
      runLog.captured_at = endedAt;

      // Write log to R2 (if available)
      let r2Key: string | null = null;
      if (env.LOGS) {
        r2Key = `runs/${msg.run_id}.json`;
        await env.LOGS.put(r2Key, JSON.stringify(runLog), { httpMetadata: { contentType: 'application/json' } });
        await increment(env, 'r2_class_a');
      }

      // Update run row — success
      await env.DB.prepare(`
        UPDATE runs SET status='success', ended_at=?, duration_ms=?, log_r2_key=?, version_sha=? WHERE id=?
      `).bind(endedAt, durationMs, r2Key, script.version_sha, msg.run_id).run();
      await increment(env, 'd1_writes');

      // Unlock workflow
      const lockId = env.WORKFLOW_LOCK.idFromName(script.id);
      await env.WORKFLOW_LOCK.get(lockId).fetch('http://do/unlock', {
        method: 'POST',
        body: JSON.stringify({ workflow_id: script.id }),
      });

      message.ack();
    } catch (err) {
      const error = err as Error;
      const { category, summary } = categorizeError(error.message);
      const durationMs = Date.now() - startTime;
      const endedAt = new Date().toISOString();

      log('error', `Workflow failed: ${error.message}`, { stack: error.stack });
      runLog.captured_at = endedAt;

      // Write error log to R2 (if available)
      let r2Key: string | null = null;
      if (env.LOGS) {
        r2Key = `runs/${msg.run_id}.json`;
        try {
          await env.LOGS.put(r2Key, JSON.stringify(runLog), { httpMetadata: { contentType: 'application/json' } });
          await increment(env, 'r2_class_a');
        } catch { /* best effort */ }
      }

      // Update run row — failed
      try {
        await env.DB.prepare(`
          UPDATE runs SET status='failed', ended_at=?, duration_ms=?, log_r2_key=?,
            error_category=?, error_summary=? WHERE id=?
        `).bind(endedAt, durationMs, r2Key, category, summary, msg.run_id).run();
        await increment(env, 'd1_writes');
      } catch { /* best effort */ }

      // Unlock workflow
      try {
        const lockId = env.WORKFLOW_LOCK.idFromName(msg.script_id);
        await env.WORKFLOW_LOCK.get(lockId).fetch('http://do/unlock', {
          method: 'POST',
          body: JSON.stringify({ workflow_id: msg.script_id }),
        });
      } catch { /* best effort */ }

      // Send failure email
      try {
        const [script, toEmails] = await Promise.all([
          env.DB.prepare('SELECT name FROM scripts WHERE id = ?').bind(msg.script_id).first<{ name: string }>(),
          getNotifyEmails(env),
        ]);
        const resendKey = env.RESEND_API_KEY ?? '';
        if (resendKey && script && toEmails.length > 0) {
          await sendFailureEmail({
            workflowName: script.name,
            workflowId: msg.script_id,
            runId: msg.run_id,
            errorCategory: category,
            errorSummary: summary,
            startedAt: new Date(Date.now() - durationMs).toISOString(),
            durationMs,
            appDomain: env.APP_DOMAIN,
            toEmails,
            fromEmail: env.RESEND_FROM_EMAIL,
            resendApiKey: resendKey,
          });
        }
      } catch { /* best effort */ }

      message.ack(); // Don't retry — we've logged the failure
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseMetadata(meta: unknown): import('./types.js').ScriptMetadata {
  if (typeof meta === 'string') {
    try { return JSON.parse(meta) as import('./types.js').ScriptMetadata; } catch { return {}; }
  }
  return (meta as import('./types.js').ScriptMetadata) ?? {};
}

async function fetchScriptFiles(env: Env, scriptId: string, ref: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const filenames = ['script.ts', 'script.test.ts', 'SKILL.md'];
  const base = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/scripts/${scriptId}`;
  for (const filename of filenames) {
    try {
      const resp = await fetch(`${base}/${filename}?ref=${encodeURIComponent(ref)}`, {
        headers: {
          Accept: 'application/vnd.github.v3.raw',
          'User-Agent': 'ops-dashboard',
          ...(env.GITHUB_PAT ? { Authorization: `Bearer ${env.GITHUB_PAT}` } : {}),
        },
      });
      if (resp.ok) files[`scripts/${scriptId}/${filename}`] = await resp.text();
    } catch { /* skip */ }
  }
  return files;
}

async function enqueueWebhook(
  env: Env,
  service: string,
  event: string,
  payload: unknown,
  dedupKey: string | undefined,
): Promise<Response> {
  // Find matching script by webhook trigger
  const scripts = await env.DB.prepare('SELECT id, metadata FROM scripts WHERE enabled = 1').all<{ id: string; metadata: string }>();

  let matchedScriptId: string | null = null;
  for (const s of scripts.results ?? []) {
    const meta = parseMetadata(s.metadata);
    const trigger = (meta.triggers ?? []).find(
      t => t.type === 'webhook' && t.service === service && (t.event === event || !t.event) && t.enabled
    );
    if (trigger) {
      matchedScriptId = s.id;
      break;
    }
  }

  if (!matchedScriptId) {
    return Response.json({ ok: true, message: 'No matching enabled webhook script' });
  }

  // Dedup check via WebhookDedup DO
  if (dedupKey) {
    const eventKey = `${matchedScriptId}:${dedupKey}`;
    const dedupId = env.WEBHOOK_DEDUP.idFromName(eventKey);
    const dedupObj = env.WEBHOOK_DEDUP.get(dedupId);
    const dedupResp = await dedupObj.fetch('http://do/check-and-set', {
      method: 'POST',
      body: JSON.stringify({ event_key: eventKey }),
    });
    const dedupResult = await dedupResp.json() as { duplicate: boolean };
    if (dedupResult.duplicate) {
      return Response.json({ ok: true, message: 'Duplicate webhook ignored' });
    }
  }

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO runs (id, script_id, status, trigger_type, trigger_detail, started_at, created_at)
    VALUES (?, ?, 'running', 'webhook', ?, ?, ?)
  `).bind(runId, matchedScriptId, `${service}.${event}`, now, now).run();

  await increment(env, 'd1_writes');

  const message: QueueMessage = {
    type: 'run_webhook',
    script_id: matchedScriptId,
    run_id: runId,
    trigger_type: 'webhook',
    trigger_detail: `${service}.${event}`,
    payload,
  };

  await env.DISPATCH_QUEUE.send(message);
  await increment(env, 'queue_ops');

  return Response.json({ ok: true, run_id: runId });
}

// ── Default export ────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
  queue: handleQueue,
} satisfies ExportedHandler<Env, QueueMessage>;
