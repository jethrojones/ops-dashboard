// Cost guardrail helpers — track daily resource usage, surface warnings.

import type { Env, UsageSnapshot } from '../types.js';

type Resource = 'worker_requests' | 'd1_writes' | 'kv_writes' | 'queue_ops' | 'r2_class_a';

const FREE_LIMITS: Record<Resource, number> = {
  worker_requests: 100_000,
  d1_writes: 100_000,
  kv_writes: 1_000,
  queue_ops: 10_000,
  r2_class_a: 33_333, // ~1M/month / 30 days
};

const YELLOW_PCT = 80;
const RED_PCT = 95;

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function increment(env: Env, resource: Resource, amount = 1): Promise<void> {
  const id = env.USAGE_COUNTER.idFromName('global');
  const obj = env.USAGE_COUNTER.get(id);
  await obj.fetch('http://do/increment', {
    method: 'POST',
    body: JSON.stringify({ resource, amount, date: todayUTC() }),
  });
}

export async function getSnapshot(env: Env): Promise<UsageSnapshot[]> {
  const id = env.USAGE_COUNTER.idFromName('global');
  const obj = env.USAGE_COUNTER.get(id);
  const resp = await obj.fetch('http://do/snapshot', { method: 'GET' });
  const data = await resp.json() as Record<string, number>;
  const today = todayUTC();
  // Always return all tracked resources so the footer always shows all 4 bars.
  return (Object.keys(FREE_LIMITS) as Resource[]).map(resource => {
    const count = data[resource] ?? 0;
    const limit = FREE_LIMITS[resource];
    return { resource, date: today, count, limit, pct: Math.round((count / limit) * 100) };
  });
}

export async function checkCircuitBreaker(env: Env): Promise<{ tripped: boolean; resource?: string; pct?: number }> {
  const snapshots = await getSnapshot(env);
  for (const s of snapshots) {
    if (s.pct >= RED_PCT && s.resource !== 'worker_requests') {
      return { tripped: true, resource: s.resource, pct: s.pct };
    }
  }
  return { tripped: false };
}

export function usageBannerState(snapshots: UsageSnapshot[]): 'green' | 'yellow' | 'red' {
  const pcts = snapshots.map(s => s.pct);
  if (pcts.some(p => p >= RED_PCT)) return 'red';
  if (pcts.some(p => p >= YELLOW_PCT)) return 'yellow';
  return 'green';
}

export function formatUsageBar(snapshot: UsageSnapshot): string {
  const name = snapshot.resource.replace(/_/g, ' ');
  return `${name}: ${snapshot.pct}% of free tier`;
}
