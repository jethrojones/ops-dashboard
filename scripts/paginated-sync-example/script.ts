// Template: sync paginated data from a "source" API into a "destination" API,
// chunking across multiple cron runs by persisting a cursor in D1.
//
// THIS SCRIPT WILL NOT RUN AS-IS — the URLs and shapes are placeholders. Edit:
//   - The two API base URLs and auth headers.
//   - The TypeScript types to match real responses.
//   - The fetch / transform / write functions.
//   - The D1 table for cursor state (a generic `sync_state` table is created
//     by migration 0005; if you want a script-specific table, add one).
//
// What this template demonstrates:
//   - Cursor persisted in D1 across runs.
//   - `dry_run` defaulting to true so first runs are read-only.
//   - `batch_size` capped at 40 to stay under the Workers 50-subrequest budget.
//   - Subrequest math you can predict.

import type { WorkflowContext } from '../../src/queue-consumer.js';

export interface PaginatedSyncParams {
  dry_run?: boolean;
  reset?: boolean;
  batch_size?: number;
}

const SOURCE_API = 'https://api.source.example/v1';
const DEST_API   = 'https://api.destination.example/v1';

// ─── Source types (replace with real shapes from your provider) ──────────────
interface SourceItem { id: string; email: string; name: string; }
interface SourcePage { items: SourceItem[]; next_cursor: string | null; }
interface SourceItemDetail { id: string; engagement_score: number; last_active_at: string; }

// ─── Destination types ───────────────────────────────────────────────────────
interface DestUpsert { external_id: string; properties: Record<string, string | number>; }

// ─── HTTP helpers ────────────────────────────────────────────────────────────
async function sourceFetch<T>(path: string, token: string): Promise<T> {
  const resp = await fetch(`${SOURCE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Source GET ${path} → ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json() as Promise<T>;
}

async function destPost(path: string, body: unknown, token: string): Promise<void> {
  const resp = await fetch(`${DEST_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Destination POST ${path} → ${resp.status}: ${text.slice(0, 200)}`);
  }
}

// ─── D1 cursor helpers ───────────────────────────────────────────────────────
async function getCursor(ctx: WorkflowContext, key: string): Promise<string | null> {
  const row = await ctx.db
    .prepare("SELECT value FROM sync_state WHERE scope = 'paginated-sync-example' AND key = ?")
    .bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setCursor(ctx: WorkflowContext, key: string, value: string): Promise<void> {
  await ctx.db
    .prepare(`
      INSERT INTO sync_state (scope, key, value, updated_at)
      VALUES ('paginated-sync-example', ?, ?, ?)
      ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    .bind(key, value, new Date().toISOString())
    .run();
}

async function deleteCursor(ctx: WorkflowContext, key: string): Promise<void> {
  await ctx.db
    .prepare("DELETE FROM sync_state WHERE scope = 'paginated-sync-example' AND key = ?")
    .bind(key).run();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function run(ctx: WorkflowContext, params?: PaginatedSyncParams): Promise<void> {
  const dryRun = params?.dry_run ?? true;
  const reset = params?.reset ?? false;
  // Hard cap at 40 so the math stays safe regardless of param input.
  // Subrequest budget on Workers free: 50 per invocation. Paid: 1000.
  // Math here: 1 list fetch + N detail fetches + 1 batch write ≤ 50 ⟹ N ≤ 48.
  // We pick 40 for a margin against unexpected extra fetches.
  const batchSize = Math.min(params?.batch_size ?? 40, 40);

  const srcToken  = ctx.secrets.source_api_token;
  const destToken = ctx.secrets.destination_api_token;

  if (!srcToken)  throw new Error('source_api_token secret is not configured');
  if (!destToken) throw new Error('destination_api_token secret is not configured');

  ctx.log('info', `Paginated sync — batch_size:${batchSize} dry_run:${dryRun} reset:${reset}`);

  if (reset) {
    await deleteCursor(ctx, 'cursor');
    ctx.log('info', 'Cursor reset — starting from the beginning');
  }

  const cursor = await getCursor(ctx, 'cursor');
  ctx.log('info', cursor ? `Resuming from cursor: ${cursor}` : 'Starting fresh (no cursor stored)');

  // 1 subrequest — fetch the source page.
  const path = cursor
    ? `/items?per_page=${batchSize}&after=${encodeURIComponent(cursor)}`
    : `/items?per_page=${batchSize}`;
  const page = await sourceFetch<SourcePage>(path, srcToken);

  ctx.log('info', `Source page returned ${page.items.length} item(s)`);
  if (page.items.length === 0) {
    if (page.next_cursor) {
      await setCursor(ctx, 'cursor', page.next_cursor);
      ctx.log('info', 'Empty page — advanced cursor anyway');
    } else {
      await deleteCursor(ctx, 'cursor');
      ctx.log('success', 'Sync complete — no more pages.');
    }
    return;
  }

  // N subrequests — one detail fetch per item.
  // Slow down with a 200ms pause to respect source rate limits.
  const details: SourceItemDetail[] = [];
  for (const item of page.items) {
    try {
      const d = await sourceFetch<SourceItemDetail>(`/items/${item.id}/detail`, srcToken);
      details.push(d);
    } catch (e) {
      ctx.log('error', `Failed to fetch detail for ${item.id}: ${(e as Error).message}`);
    }
    await sleep(200);
  }

  ctx.log('info', `Fetched detail for ${details.length}/${page.items.length} item(s)`);

  // 1 subrequest — batch upsert into the destination.
  const upserts: DestUpsert[] = page.items.map(item => {
    const d = details.find(x => x.id === item.id);
    return {
      external_id: item.id,
      properties: {
        email: item.email,
        name: item.name,
        engagement_score: d?.engagement_score ?? 0,
        last_active_at: d?.last_active_at ?? '',
      },
    };
  });

  if (dryRun) {
    ctx.log('info', `[DRY RUN] Would upsert ${upserts.length} record(s) to destination`, { sample: upserts[0] });
  } else {
    await destPost('/contacts/batch_upsert', { inputs: upserts }, destToken);
    ctx.log('success', `Upserted ${upserts.length} record(s) to destination`);
  }

  // Advance or clear the cursor.
  if (page.next_cursor) {
    if (!dryRun) await setCursor(ctx, 'cursor', page.next_cursor);
    ctx.log('info', `Cursor advanced to: ${page.next_cursor}`);
  } else {
    if (!dryRun) await deleteCursor(ctx, 'cursor');
    ctx.log('success', 'Sync complete — no more pages.');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
