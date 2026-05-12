import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types.js';

// SQLite-backed DO for per-workflow concurrency locks.
// Strongly consistent test-and-set — no race window.

export class WorkflowLock extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS locks (
        workflow_id  TEXT PRIMARY KEY,
        run_id       TEXT NOT NULL,
        locked_at    TEXT NOT NULL
      )
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() as Record<string, string> : {};

    if (url.pathname === '/try-lock') {
      const { workflow_id, run_id } = body;
      const existing = this.ctx.storage.sql
        .exec<{ run_id: string }>('SELECT run_id FROM locks WHERE workflow_id = ?', workflow_id)
        .toArray();
      if (existing.length > 0) {
        return Response.json({ locked: false, by_run_id: existing[0].run_id });
      }
      this.ctx.storage.sql.exec(
        'INSERT INTO locks (workflow_id, run_id, locked_at) VALUES (?, ?, ?)',
        workflow_id, run_id, new Date().toISOString(),
      );
      return Response.json({ locked: true });
    }

    if (url.pathname === '/unlock') {
      this.ctx.storage.sql.exec('DELETE FROM locks WHERE workflow_id = ?', body.workflow_id);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/status') {
      const rows = this.ctx.storage.sql
        .exec<{ run_id: string; locked_at: string }>('SELECT run_id, locked_at FROM locks WHERE workflow_id = ?', body.workflow_id)
        .toArray();
      return Response.json(rows[0] ?? null);
    }

    return new Response('Not found', { status: 404 });
  }
}
