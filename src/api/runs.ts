import { Hono } from 'hono';
import type { Env, Run, Script, RunLog, ScriptMetadata } from '../types.js';
import { requireAuth } from './auth.js';
import { increment } from '../lib/usage.js';
import { buildDebugPayload } from '../lib/payload.js';

export const runsRouter = new Hono<{ Bindings: Env }>();

function parseMetadata(meta: unknown): ScriptMetadata {
  if (typeof meta === 'string') {
    try { return JSON.parse(meta) as ScriptMetadata; } catch { return {}; }
  }
  return (meta as ScriptMetadata) ?? {};
}

// ── Auth middleware ──────────────────────────────────────────────────────────
runsRouter.use('*', async (c, next) => {
  return requireAuth(c.env)(c, next);
});

// ── GET /api/runs ────────────────────────────────────────────────────────────
runsRouter.get('/', async (c) => {
  const env = c.env;

  const runs = await env.DB.prepare(`
    SELECT r.*, s.name as script_name
    FROM runs r
    JOIN scripts s ON s.id = r.script_id
    ORDER BY r.started_at DESC
    LIMIT 25
  `).all<Run & { script_name: string }>();

  return c.json({ runs: runs.results ?? [] });
});

// ── GET /api/runs/:id ────────────────────────────────────────────────────────
runsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const env = c.env;

  const run = await env.DB.prepare(`
    SELECT r.*, s.name as script_name
    FROM runs r
    JOIN scripts s ON s.id = r.script_id
    WHERE r.id = ?
  `).bind(id).first<Run & { script_name: string }>();

  if (!run) return c.json({ error: 'Run not found' }, 404);

  return c.json({ run });
});

// ── DELETE /api/runs/:id ─────────────────────────────────────────────────────
runsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const env = c.env;

  const run = await env.DB.prepare('SELECT log_r2_key FROM runs WHERE id = ?').bind(id).first<{ log_r2_key: string | null }>();
  if (!run) return c.json({ error: 'Run not found' }, 404);

  // Best-effort R2 cleanup before deleting the D1 row. Both the verbose log
  // and the cached Copy-for-Claude debug payload can contain operational
  // detail that should go away when the user clears the run.
  if (env.LOGS) {
    if (run.log_r2_key) await env.LOGS.delete(run.log_r2_key).catch(() => {});
    await env.LOGS.delete(`runs/${id}-debug.json`).catch(() => {});
  }

  await env.DB.prepare('DELETE FROM runs WHERE id = ?').bind(id).run();
  await increment(env, 'd1_writes');

  return c.json({ ok: true });
});

// ── DELETE /api/runs (clear all failed) ──────────────────────────────────────
runsRouter.delete('/', async (c) => {
  const env = c.env;
  const { status } = c.req.query();
  if (status !== 'failed' && status !== 'skipped') {
    return c.json({ error: 'Only ?status=failed or ?status=skipped allowed' }, 400);
  }

  // Best-effort R2 cleanup before bulk D1 delete. Capped to keep the
  // subrequest budget bounded; remaining R2 objects are pruned on the next
  // clear-all click (or by hand).
  if (env.LOGS) {
    const rows = await env.DB.prepare(
      'SELECT id, log_r2_key FROM runs WHERE status = ? LIMIT 40'
    ).bind(status).all<{ id: string; log_r2_key: string | null }>();
    for (const row of rows.results ?? []) {
      if (row.log_r2_key) await env.LOGS.delete(row.log_r2_key).catch(() => {});
      await env.LOGS.delete(`runs/${row.id}-debug.json`).catch(() => {});
    }
  }

  const result = await env.DB.prepare('DELETE FROM runs WHERE status = ?').bind(status).run();
  await increment(env, 'd1_writes');
  return c.json({ ok: true, deleted: result.meta?.changes ?? 0 });
});

// ── GET /api/runs/:id/log ────────────────────────────────────────────────────
runsRouter.get('/:id/log', async (c) => {
  const { id } = c.req.param();
  const env = c.env;

  const run = await env.DB.prepare('SELECT log_r2_key FROM runs WHERE id = ?').bind(id).first<{ log_r2_key: string | null }>();
  if (!run) return c.json({ error: 'Run not found' }, 404);

  if (!run.log_r2_key) {
    // Return empty log if no R2 key yet
    return c.json({ run_id: id, script_id: '', steps: [], captured_at: new Date().toISOString() } satisfies RunLog);
  }

  if (!env.LOGS) {
    return c.json({ run_id: id, script_id: '', steps: [], captured_at: new Date().toISOString() } satisfies RunLog);
  }

  const obj = await env.LOGS.get(run.log_r2_key);
  if (!obj) {
    return c.json({ run_id: id, script_id: '', steps: [], captured_at: new Date().toISOString() } satisfies RunLog);
  }

  const log = await obj.json<RunLog>();
  return c.json(log);
});

// ── POST /api/runs/:id/copy-for-claude ───────────────────────────────────────
runsRouter.post('/:id/copy-for-claude', async (c) => {
  const { id } = c.req.param();
  const env = c.env;

  // Check for cached debug payload (only if R2 is available)
  const cacheKey = `runs/${id}-debug.json`;
  if (env.LOGS) {
    const cached = await env.LOGS.get(cacheKey);
    if (cached) {
      const data = await cached.json<{ payload: string }>();
      if (data.payload) return c.json({ payload: data.payload });
    }
  }

  // Fetch run
  const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(id).first<Run>();
  if (!run) return c.json({ error: 'Run not found' }, 404);

  // Fetch script
  const script = await env.DB.prepare('SELECT * FROM scripts WHERE id = ?').bind(run.script_id).first<Script>();
  if (!script) return c.json({ error: 'Script not found' }, 404);

  const parsedScript: Script = { ...script, metadata: parseMetadata(script.metadata) };

  // Fetch log from R2 (if available)
  let log: RunLog = { run_id: id, script_id: script.id, steps: [], captured_at: new Date().toISOString() };
  if (env.LOGS && run.log_r2_key) {
    const obj = await env.LOGS.get(run.log_r2_key);
    if (obj) {
      try { log = await obj.json<RunLog>(); } catch { /* use empty */ }
    }
  }

  // Fetch source files from GitHub
  const ref = run.version_sha ?? 'main';
  const sourceFiles = await fetchScriptFilesFromGitHub(env, script.id, ref);

  const payload = buildDebugPayload(parsedScript, run, log, sourceFiles);

  // Cache the payload in R2 (if available)
  if (env.LOGS) {
    await env.LOGS.put(cacheKey, JSON.stringify({ payload }), {
      httpMetadata: { contentType: 'application/json' },
    });
    await increment(env, 'r2_class_a');
  }

  return c.json({ payload });
});

// ── Helper: fetch script source files from GitHub ───────────────────────────
async function fetchScriptFilesFromGitHub(env: Env, scriptId: string, ref: string): Promise<Record<string, string>> {
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
      if (resp.ok) {
        files[`scripts/${scriptId}/${filename}`] = await resp.text();
      }
    } catch { /* skip */ }
  }

  return files;
}
