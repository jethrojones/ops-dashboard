import { Hono } from 'hono';
import type { Env, Script, Run, QueueMessage } from '../types.js';
import { requireAuth, getUser } from './auth.js';
import { increment } from '../lib/usage.js';
import { buildEditPayload } from '../lib/payload.js';
import { computeNextRun, isValidCron } from '../lib/cron.js';

export const workflowsRouter = new Hono<{ Bindings: Env }>();

// ── Auth middleware ──────────────────────────────────────────────────────────
workflowsRouter.use('*', async (c, next) => {
  return requireAuth(c.env)(c, next);
});

// ── GET /api/workflows ───────────────────────────────────────────────────────
workflowsRouter.get('/', async (c) => {
  const env = c.env;

  const scriptsResult = await env.DB.prepare(`
    SELECT s.*, sc.cron_expression, sc.next_run_at, sc.business_hours_only
    FROM scripts s
    LEFT JOIN schedules sc ON sc.script_id = s.id
    ORDER BY s.name
  `).all<Script & { cron_expression?: string; next_run_at?: string; business_hours_only?: number }>();

  const scripts = scriptsResult.results ?? [];

  // For each script, fetch last run
  const withRuns = await Promise.all(scripts.map(async (s) => {
    const lastRun = await env.DB.prepare(`
      SELECT * FROM runs WHERE script_id = ? ORDER BY started_at DESC LIMIT 1
    `).bind(s.id).first<Run>();
    return { ...s, last_run: lastRun ?? undefined };
  }));

  return c.json({ scripts: withRuns });
});

// ── GET /api/workflows/:id ───────────────────────────────────────────────────
workflowsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const env = c.env;

  const script = await env.DB.prepare(`
    SELECT s.*, sc.cron_expression, sc.next_run_at, sc.timezone, sc.business_hours_only, sc.updated_at as schedule_updated_at
    FROM scripts s
    LEFT JOIN schedules sc ON sc.script_id = s.id
    WHERE s.id = ?
  `).bind(id).first<Script & { cron_expression?: string; next_run_at?: string; timezone?: string; business_hours_only?: number }>();

  if (!script) return c.json({ error: 'Workflow not found' }, 404);

  // Parse metadata if stored as JSON string
  let parsedMeta: import('../types.js').ScriptMetadata = {};
  const rawMeta = script.metadata as unknown;
  if (typeof rawMeta === 'string') {
    try { parsedMeta = JSON.parse(rawMeta) as import('../types.js').ScriptMetadata; } catch { /* leave empty */ }
  } else if (rawMeta && typeof rawMeta === 'object') {
    parsedMeta = rawMeta as import('../types.js').ScriptMetadata;
  }

  return c.json({ script: { ...script, metadata: parsedMeta } });
});

// ── POST /api/workflows/:id/run ──────────────────────────────────────────────
workflowsRouter.post('/:id/run', async (c) => {
  const { id } = c.req.param();
  const env = c.env;
  const user = getUser(c);

  const script = await env.DB.prepare('SELECT * FROM scripts WHERE id = ?').bind(id).first<Script>();
  if (!script) return c.json({ error: 'Workflow not found' }, 404);

  let input: unknown = undefined;
  try {
    const body = await c.req.json<{ input?: unknown }>();
    input = body?.input;
  } catch { /* no body or invalid JSON */ }

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO runs (id, script_id, status, trigger_type, trigger_detail, started_at, triggered_by, created_at)
    VALUES (?, ?, 'running', 'manual', NULL, ?, ?, ?)
  `).bind(runId, id, now, user.email, now).run();

  await increment(env, 'd1_writes');

  const message: QueueMessage = {
    type: 'run_workflow',
    script_id: id,
    run_id: runId,
    trigger_type: 'manual',
    triggered_by: user.email,
    payload: input,
  };

  await env.DISPATCH_QUEUE.send(message);
  await increment(env, 'queue_ops');

  // Audit log
  await env.DB.prepare(`
    INSERT INTO audit_log (id, user_email, action, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, 'run_now', 'script', ?, ?, ?)
  `).bind(crypto.randomUUID(), user.email, id, JSON.stringify({ run_id: runId }), now).run();

  await increment(env, 'd1_writes');

  return c.json({ run_id: runId, status: 'queued' });
});

// ── POST /api/workflows/:id/toggle ──────────────────────────────────────────
workflowsRouter.post('/:id/toggle', async (c) => {
  const { id } = c.req.param();
  const env = c.env;
  const user = getUser(c);

  const body = await c.req.json<{ enabled: boolean }>();
  const enabled = body.enabled ? 1 : 0;
  const now = new Date().toISOString();

  const script = await env.DB.prepare('SELECT id FROM scripts WHERE id = ?').bind(id).first<{ id: string }>();
  if (!script) return c.json({ error: 'Workflow not found' }, 404);

  await env.DB.prepare(`
    UPDATE scripts SET enabled = ?, updated_at = ? WHERE id = ?
  `).bind(enabled, now, id).run();

  await increment(env, 'd1_writes');

  await env.DB.prepare(`
    INSERT INTO audit_log (id, user_email, action, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, ?, 'script', ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    user.email,
    enabled ? 'enable_workflow' : 'disable_workflow',
    id,
    JSON.stringify({ enabled: !!enabled }),
    now,
  ).run();

  await increment(env, 'd1_writes');

  return c.json({ ok: true, enabled: !!enabled });
});

// ── PUT /api/workflows/:id/schedule ─────────────────────────────────────────
workflowsRouter.put('/:id/schedule', async (c) => {
  const { id } = c.req.param();
  const env = c.env;
  const user = getUser(c);

  const body = await c.req.json<{ cron_expression: string | null; business_hours_only?: boolean }>();
  const now = new Date().toISOString();

  const script = await env.DB.prepare('SELECT id FROM scripts WHERE id = ?').bind(id).first<{ id: string }>();
  if (!script) return c.json({ error: 'Workflow not found' }, 404);

  // Reject unparseable cron up front so the schedule isn't silently
  // disabled by a NULL next_run_at.
  if (body.cron_expression && !isValidCron(body.cron_expression)) {
    return c.json({
      error: "That cron expression isn't supported. Use 5-field syntax (minute hour day month weekday); supported tokens are *, N, N-M, N,M,O, */N, and N-M/S.",
    }, 400);
  }
  const nextRunAt = body.cron_expression ? computeNextRun(body.cron_expression) : null;
  if (body.cron_expression && !nextRunAt) {
    return c.json({
      error: "That cron expression doesn't fire within the next week. Double-check the values.",
    }, 400);
  }

  // Upsert schedule
  await env.DB.prepare(`
    INSERT INTO schedules (script_id, cron_expression, next_run_at, timezone, business_hours_only, updated_at)
    VALUES (?, ?, ?, 'UTC', ?, ?)
    ON CONFLICT(script_id) DO UPDATE SET
      cron_expression = excluded.cron_expression,
      next_run_at = excluded.next_run_at,
      business_hours_only = excluded.business_hours_only,
      updated_at = excluded.updated_at
  `).bind(
    id,
    body.cron_expression,
    nextRunAt,
    body.business_hours_only ? 1 : 0,
    now,
  ).run();

  await increment(env, 'd1_writes');

  await env.DB.prepare(`
    INSERT INTO audit_log (id, user_email, action, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, 'update_schedule', 'script', ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    user.email,
    id,
    JSON.stringify({ cron_expression: body.cron_expression, business_hours_only: body.business_hours_only }),
    now,
  ).run();

  await increment(env, 'd1_writes');

  return c.json({ ok: true, next_run_at: nextRunAt });
});

// ── GET /api/workflows/:id/edit-payload ─────────────────────────────────────
workflowsRouter.get('/:id/edit-payload', async (c) => {
  const { id } = c.req.param();
  const env = c.env;

  const rawScript = await env.DB.prepare('SELECT * FROM scripts WHERE id = ?').bind(id).first<Script>();
  if (!rawScript) return c.json({ error: 'Workflow not found' }, 404);

  const script: Script = { ...rawScript, metadata: parseMetadataLocal(rawScript.metadata) };

  const recentRuns = await env.DB.prepare(`
    SELECT * FROM runs WHERE script_id = ? ORDER BY started_at DESC LIMIT 5
  `).bind(id).all<Run>();

  // Fetch source files from GitHub
  const sourceFiles = await fetchScriptFilesFromGitHub(env, id, script.version_sha ?? 'main');

  const payload = buildEditPayload(script, recentRuns.results ?? [], sourceFiles);
  return c.json({ payload });
});

// ── GET /api/workflows/:id/runs ─────────────────────────────────────────────
workflowsRouter.get('/:id/runs', async (c) => {
  const { id } = c.req.param();
  const env = c.env;

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const statusFilter = c.req.query('status') ?? '';
  const limit = Math.min(50, parseInt(c.req.query('limit') ?? '20', 10));
  const offset = (page - 1) * limit;

  const script = await env.DB.prepare('SELECT id FROM scripts WHERE id = ?').bind(id).first<{ id: string }>();
  if (!script) return c.json({ error: 'Workflow not found' }, 404);

  let countSql = 'SELECT COUNT(*) as cnt FROM runs WHERE script_id = ?';
  let runsSql = 'SELECT * FROM runs WHERE script_id = ?';
  const binds: (string | number)[] = [id];

  if (statusFilter) {
    countSql += ' AND status = ?';
    runsSql += ' AND status = ?';
    binds.push(statusFilter);
  }

  const total = await env.DB.prepare(countSql).bind(...binds).first<{ cnt: number }>();
  const runs = await env.DB.prepare(
    runsSql + ' ORDER BY started_at DESC LIMIT ? OFFSET ?'
  ).bind(...binds, limit, offset).all<Run>();

  return c.json({
    runs: runs.results ?? [],
    total: total?.cnt ?? 0,
    page,
    totalPages: Math.ceil((total?.cnt ?? 0) / limit),
  });
});

// ── Helper: fetch script source files from GitHub ───────────────────────────
async function fetchScriptFilesFromGitHub(env: Env, scriptId: string, ref: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const filenames = ['script.ts', 'script.test.ts', 'SKILL.md'];
  const base = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/scripts/${scriptId}`;

  for (const filename of filenames) {
    try {
      const resp = await fetch(`${base}/${filename}?ref=${ref}`, {
        headers: {
          Accept: 'application/vnd.github.v3.raw',
          'User-Agent': 'ops-dashboard',
          ...(env.GITHUB_PAT ? { Authorization: `Bearer ${env.GITHUB_PAT}` } : {}),
        },
      });
      if (resp.ok) {
        files[`scripts/${scriptId}/${filename}`] = await resp.text();
      }
    } catch { /* skip missing files */ }
  }

  return files;
}

// ── Helper: parse script metadata ───────────────────────────────────────────
function parseMetadataLocal(meta: unknown): import('../types.js').ScriptMetadata {
  if (typeof meta === 'string') {
    try { return JSON.parse(meta) as import('../types.js').ScriptMetadata; } catch { return {}; }
  }
  return (meta as import('../types.js').ScriptMetadata) ?? {};
}

