import { Hono } from 'hono';
import type { Env } from '../types.js';

export const settingsRouter = new Hono<{ Bindings: Env }>();

async function getNotifyEmails(env: Env): Promise<string[]> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'notify_emails'").first<{ value: string }>();
  if (!row) return env.NOTIFY_EMAILS ? env.NOTIFY_EMAILS.split(',').map(s => s.trim()).filter(Boolean) : [];
  try { return JSON.parse(row.value) as string[]; } catch { return []; }
}

settingsRouter.get('/notify-emails', async (c) => {
  const emails = await getNotifyEmails(c.env);
  return c.json({ emails });
});

settingsRouter.post('/notify-emails', async (c) => {
  const body = await c.req.json<{ email: string; enabled: boolean }>();
  const { email, enabled } = body;
  if (!email) return c.json({ error: 'email required' }, 400);

  const current = await getNotifyEmails(c.env);
  let updated: string[];
  if (enabled) {
    updated = current.includes(email) ? current : [...current, email];
  } else {
    updated = current.filter(e => e !== email);
  }

  await c.env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('notify_emails', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  ).bind(JSON.stringify(updated), new Date().toISOString()).run();

  return c.json({ ok: true, emails: updated });
});

export { getNotifyEmails };
