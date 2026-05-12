import { Hono } from 'hono';
import type { Env, DeployJob } from '../types.js';
import { requireAuth, getUser } from './auth.js';
import { parsePasteback, checkContainment } from '../lib/containment.js';
import { createBranchAndCommit, getPrStatus, mergePr, createRevertCommit } from '../lib/github.js';
import { decrypt } from '../lib/crypto.js';
import { increment } from '../lib/usage.js';

export const deployRouter = new Hono<{ Bindings: Env }>();

// ── Auth middleware ──────────────────────────────────────────────────────────
deployRouter.use('*', async (c, next) => {
  return requireAuth(c.env)(c, next);
});

// ── POST /api/workflows/:id/pasteback ──────────────────────────────────────
deployRouter.post('/workflows/:id/pasteback', async (c) => {
  const { id } = c.req.param();
  const env = c.env;
  const user = getUser(c);

  const body = await c.req.json<{ raw: string }>();
  if (!body.raw) return c.json({ error: 'Missing raw paste content' }, 400);

  const parseResult = parsePasteback(body.raw);
  if (!parseResult.ok) return c.json({ error: parseResult.error }, 400);

  const { data } = parseResult;
  if (data.workflow_id !== id) {
    return c.json({
      error: `Pasteback workflow_id '${data.workflow_id}' does not match URL parameter '${id}'.`,
    }, 400);
  }

  // Load all live secret values for exfiltration scan
  const secretRows = await env.DB.prepare('SELECT encrypted_blob FROM secrets').all<{ encrypted_blob: string }>();
  const liveSecretValues: string[] = [];
  for (const row of secretRows.results ?? []) {
    try {
      const val = await decrypt(row.encrypted_blob, env.OPS_SECRETS_MASTER_KEY);
      if (val) liveSecretValues.push(val);
    } catch { /* skip */ }
  }

  const containment = checkContainment(id, data.files, liveSecretValues);
  const now = new Date().toISOString();

  if (!containment.safe) {
    await env.DB.prepare(`
      INSERT INTO audit_log (id, user_email, action, resource_type, resource_id, detail, created_at)
      VALUES (?, ?, 'pasteback_blocked', 'script', ?, ?, ?)
    `).bind(
      crypto.randomUUID(), user.email, id,
      JSON.stringify({ reason: containment.reason, flaggedPattern: containment.flaggedPattern }),
      now,
    ).run();
    await increment(env, 'd1_writes');
    return c.json({ error: containment.reason, flagged_pattern: containment.flaggedPattern }, 400);
  }

  const result = await createBranchAndCommit(
    env.GITHUB_PAT,
    env.GITHUB_REPO_OWNER,
    env.GITHUB_REPO_NAME,
    id,
    data.files,
    data.parent_sha,
  );

  const deployId = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO deploy_jobs (id, script_id, initiated_by, branch_name, pr_number, pr_sha, parent_sha, status, stage_detail, started_at, is_rollback)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'testing', 'CI running', ?, 0)
  `).bind(
    deployId, id, user.email,
    result.branchName, result.prNumber, result.commitSha, data.parent_sha,
    now,
  ).run();

  await increment(env, 'd1_writes');

  await env.DB.prepare(`
    INSERT INTO audit_log (id, user_email, action, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, 'pasteback_deploy', 'script', ?, ?, ?)
  `).bind(
    crypto.randomUUID(), user.email, id,
    JSON.stringify({ deploy_id: deployId, pr_number: result.prNumber, pr_url: result.prUrl }),
    now,
  ).run();

  await increment(env, 'd1_writes');

  return c.json({ deploy_id: deployId, pr_number: result.prNumber, pr_url: result.prUrl });
});

// ── GET /api/workflows/:id/deploy/:deployId ─────────────────────────────────
deployRouter.get('/workflows/:id/deploy/:deployId', async (c) => {
  const { id, deployId } = c.req.param();
  const env = c.env;

  const job = await env.DB.prepare('SELECT * FROM deploy_jobs WHERE id = ? AND script_id = ?').bind(deployId, id).first<DeployJob>();
  if (!job) return c.json({ error: 'Deploy job not found' }, 404);

  if (job.status === 'testing' && job.pr_number) {
    try {
      const prStatus = await getPrStatus(env.GITHUB_PAT, env.GITHUB_REPO_OWNER, env.GITHUB_REPO_NAME, job.pr_number);
      const now = new Date().toISOString();

      if (prStatus.checksStatus === 'success') {
        await env.DB.prepare(
          'UPDATE deploy_jobs SET status=\'merging\', stage_detail=\'Merging PR\' WHERE id=?'
        ).bind(deployId).run();

        const merged = await mergePr(
          env.GITHUB_PAT, env.GITHUB_REPO_OWNER, env.GITHUB_REPO_NAME, job.pr_number, job.pr_sha!
        );

        if (merged) {
          await env.DB.prepare(
            'UPDATE deploy_jobs SET status=\'deployed\', stage_detail=\'Deployed\', completed_at=? WHERE id=?'
          ).bind(now, deployId).run();
        } else {
          await env.DB.prepare(
            'UPDATE deploy_jobs SET status=\'failed\', stage_detail=\'Merge failed\', completed_at=? WHERE id=?'
          ).bind(now, deployId).run();
        }
        await increment(env, 'd1_writes');
      } else if (prStatus.checksStatus === 'failure') {
        const now = new Date().toISOString();
        await env.DB.prepare(
          'UPDATE deploy_jobs SET status=\'failed\', stage_detail=\'CI checks failed\', completed_at=? WHERE id=?'
        ).bind(now, deployId).run();
        await increment(env, 'd1_writes');
      }
      // If still 'pending', no status change
    } catch (err) {
      console.error('Deploy poll error:', err);
    }
  }

  const updated = await env.DB.prepare('SELECT * FROM deploy_jobs WHERE id = ?').bind(deployId).first<DeployJob>();
  const prUrl = updated?.pr_number
    ? `https://github.com/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/pull/${updated.pr_number}`
    : null;

  return c.json({
    status: updated?.status,
    stage_detail: updated?.stage_detail,
    pr_url: prUrl,
    commit_sha: updated?.pr_sha,
  });
});

// ── POST /api/workflows/:id/rollback/:deployId ───────────────────────────────
deployRouter.post('/workflows/:id/rollback/:deployId', async (c) => {
  const { id, deployId } = c.req.param();
  const env = c.env;
  const user = getUser(c);

  const job = await env.DB.prepare('SELECT * FROM deploy_jobs WHERE id = ? AND script_id = ?').bind(deployId, id).first<DeployJob>();
  if (!job) return c.json({ error: 'Deploy job not found' }, 404);
  if (!job.pr_sha) return c.json({ error: 'No commit SHA to revert — cannot roll back this deploy' }, 400);

  const result = await createRevertCommit(
    env.GITHUB_PAT,
    env.GITHUB_REPO_OWNER,
    env.GITHUB_REPO_NAME,
    id,
    job.pr_sha,
  );

  const newDeployId = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO deploy_jobs (id, script_id, initiated_by, branch_name, pr_number, pr_sha, parent_sha, status, stage_detail, started_at, is_rollback)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'testing', 'Rollback CI running', ?, 1)
  `).bind(
    newDeployId, id, user.email,
    result.branchName, result.prNumber, result.commitSha, job.pr_sha,
    now,
  ).run();

  await increment(env, 'd1_writes');

  await env.DB.prepare(`
    INSERT INTO audit_log (id, user_email, action, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, 'rollback', 'script', ?, ?, ?)
  `).bind(
    crypto.randomUUID(), user.email, id,
    JSON.stringify({ original_deploy_id: deployId, new_deploy_id: newDeployId, pr_url: result.prUrl }),
    now,
  ).run();

  await increment(env, 'd1_writes');

  return c.json({ deploy_id: newDeployId, pr_number: result.prNumber, pr_url: result.prUrl });
});
