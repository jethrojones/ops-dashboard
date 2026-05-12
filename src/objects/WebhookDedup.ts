import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types.js';

// SQLite-backed DO for webhook deduplication.
// Ensures a burst of identical webhook events doesn't trigger multiple runs.

const TTL_HOURS = 24;

export class WebhookDedup extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS seen (
        event_key  TEXT PRIMARY KEY,
        seen_at    TEXT NOT NULL
      )
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/check-and-set') {
      const { event_key } = await request.json() as { event_key: string };

      // Prune stale entries first
      const cutoff = new Date(Date.now() - TTL_HOURS * 3600 * 1000).toISOString();
      this.ctx.storage.sql.exec('DELETE FROM seen WHERE seen_at < ?', cutoff);

      const existing = this.ctx.storage.sql
        .exec<{ event_key: string }>('SELECT event_key FROM seen WHERE event_key = ?', event_key)
        .toArray();

      if (existing.length > 0) {
        return Response.json({ duplicate: true });
      }

      this.ctx.storage.sql.exec(
        'INSERT INTO seen (event_key, seen_at) VALUES (?, ?)',
        event_key, new Date().toISOString(),
      );
      return Response.json({ duplicate: false });
    }

    return new Response('Not found', { status: 404 });
  }
}
