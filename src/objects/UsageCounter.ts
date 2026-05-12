import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types.js';

// SQLite-backed DO for authoritative daily usage counters.
// Not KV — KV has a 1,000 write/day cap which would be exhausted by tick-by-tick counting.

export class UsageCounter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        resource   TEXT NOT NULL,
        date       TEXT NOT NULL,
        count      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (resource, date)
      )
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/increment') {
      const { resource, amount = 1, date } = await request.json() as { resource: string; amount?: number; date: string };
      this.ctx.storage.sql.exec(`
        INSERT INTO counters (resource, date, count) VALUES (?, ?, ?)
        ON CONFLICT (resource, date) DO UPDATE SET count = count + excluded.count
      `, resource, date, amount);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/snapshot') {
      const today = new Date().toISOString().slice(0, 10);
      const rows = this.ctx.storage.sql
        .exec<{ resource: string; count: number }>('SELECT resource, count FROM counters WHERE date = ?', today)
        .toArray();
      const result: Record<string, number> = {};
      for (const row of rows) result[row.resource] = row.count;
      return Response.json(result);
    }

    if (url.pathname === '/sustained-yellow') {
      // Returns resources that have been >= 80% for 14+ consecutive days.
      const rows = this.ctx.storage.sql
        .exec<{ resource: string; date: string; count: number }>(`
          SELECT resource, date, count FROM counters
          WHERE date >= date('now', '-14 days')
          ORDER BY resource, date
        `)
        .toArray();
      // Group by resource; return those with 14+ days of data
      const grouped: Record<string, number[]> = {};
      for (const r of rows) {
        if (!grouped[r.resource]) grouped[r.resource] = [];
        grouped[r.resource].push(r.count);
      }
      const sustained: string[] = [];
      for (const [resource, counts] of Object.entries(grouped)) {
        if (counts.length >= 14) sustained.push(resource);
      }
      return Response.json(sustained);
    }

    return new Response('Not found', { status: 404 });
  }
}
