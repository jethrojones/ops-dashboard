import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requireAuth, getUser } from './auth.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { increment } from '../lib/usage.js';

export const secretsRouter = new Hono<{ Bindings: Env }>();

// ── Auth middleware ──────────────────────────────────────────────────────────
secretsRouter.use('*', async (c, next) => {
  return requireAuth(c.env)(c, next);
});

// ── GET /api/secrets ─────────────────────────────────────────────────────────
secretsRouter.get('/', async (c) => {
  const env = c.env;

  const rows = await env.DB.prepare(`
    SELECT service, last_rotated_at FROM secrets ORDER BY service
  `).all<{ service: string; last_rotated_at: string | null }>();

  return c.json({ secrets: rows.results ?? [] });
});

// ── POST /api/secrets/:service ────────────────────────────────────────────────
secretsRouter.post('/:service', async (c) => {
  const { service } = c.req.param();
  const env = c.env;
  const user = getUser(c);

  const body = await c.req.json<{ value: string }>();
  if (!body.value || typeof body.value !== 'string' || !body.value.trim()) {
    return c.json({ error: 'Missing or empty value' }, 400);
  }

  const value = body.value.trim();
  const encrypted = await encrypt(value, env.OPS_SECRETS_MASTER_KEY);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO secrets (service, encrypted_blob, last_rotated_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(service) DO UPDATE SET
      encrypted_blob = excluded.encrypted_blob,
      last_rotated_at = excluded.last_rotated_at
  `).bind(service, encrypted, now, now).run();

  await increment(env, 'd1_writes');

  // Invalidate KV cache for connection status
  await env.CACHE.delete('conn_status');
  await env.CACHE.delete(`conn_status_${service}`);

  // Audit log
  await env.DB.prepare(`
    INSERT INTO audit_log (id, user_email, action, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, 'rotate_secret', 'secret', ?, ?, ?)
  `).bind(crypto.randomUUID(), user.email, service, JSON.stringify({ service }), now).run();

  await increment(env, 'd1_writes');

  return c.json({ ok: true, service, last_rotated_at: now });
});

// ── GET /api/secrets/:service/status ─────────────────────────────────────────
secretsRouter.get('/:service/status', async (c) => {
  const { service } = c.req.param();
  const env = c.env;

  // Check KV cache first
  const cacheKey = `conn_status_${service}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    try {
      return c.json(JSON.parse(cached));
    } catch { /* fall through */ }
  }

  const row = await env.DB.prepare('SELECT encrypted_blob FROM secrets WHERE service = ?').bind(service).first<{ encrypted_blob: string }>();

  if (!row) {
    return c.json({ ok: false, message: 'No credential stored for this service.' });
  }

  let plaintext: string;
  try {
    plaintext = await decrypt(row.encrypted_blob, env.OPS_SECRETS_MASTER_KEY);
  } catch {
    return c.json({ ok: false, message: "We couldn't decrypt the stored credential — re-paste it to fix." });
  }

  const result = await testServiceCredential(service, plaintext);

  // Cache result for 2 minutes
  await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 120 });

  return c.json(result);
});

// ── Service-specific credential checks ───────────────────────────────────────
async function testServiceCredential(service: string, credential: string): Promise<{ ok: boolean; message: string }> {
  try {
    switch (service) {
      case 'hubspot':
        return await checkHubSpot(credential);

      case 'kit':
        return await checkKit(credential);

      case 'docuseal':
        return await checkDocuSeal(credential);

      case 'resend':
        return checkResend(credential);

      case 'drive':
        return checkDrive(credential);

      case 'instantly':
        return await checkInstantly(credential);

      case 'docuseal_webhook_secret':
        // Just verify it's non-empty — no API to check
        return credential.length >= 8
          ? { ok: true, message: 'Webhook secret is set.' }
          : { ok: false, message: 'Webhook secret too short (minimum 8 characters).' };

      case 'hubspot_invoice_sent_stage_id':
        return /^\d+$/.test(credential)
          ? { ok: true, message: `Stage ID ${credential} — deals are automatically moved to this stage when DocuSeal reports a completed signing.` }
          : { ok: false, message: 'Stage ID should be a numeric string.' };

      case 'brave_search':
        return await checkBraveSearch(credential);

      case 'github_pat':
        return await checkGitHubPat(credential);

      default:
        // Unknown service — just confirm it's non-empty
        return { ok: credential.length > 0, message: credential.length > 0 ? 'Credential is set.' : 'Credential is empty.' };
    }
  } catch (err) {
    console.error(`Connection check failed for ${service}:`, err);
    return { ok: false, message: `Couldn't reach ${service} right now — try again in a moment.` };
  }
}

async function checkHubSpot(token: string): Promise<{ ok: boolean; message: string }> {
  const resp = await fetch('https://api.hubapi.com/account-info/v3/details', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.ok) {
    const data = await resp.json() as { portalId?: number; uiDomain?: string };
    return { ok: true, message: `HubSpot connected — portal ID ${data.portalId ?? 'unknown'}.` };
  }
  if (resp.status === 401) return { ok: false, message: 'HubSpot: token rejected — rotate your Private App token.' };
  if (resp.status === 403) return { ok: false, message: 'HubSpot: permission denied — check the token scopes.' };
  return { ok: false, message: `HubSpot: unexpected response (status ${resp.status}) — try again or check status.hubspot.com.` };
}

async function checkKit(token: string): Promise<{ ok: boolean; message: string }> {
  // Kit v4 uses X-Kit-Api-Key header (not Authorization: Bearer)
  const resp = await fetch('https://api.kit.com/v4/account', {
    headers: { 'X-Kit-Api-Key': token, Accept: 'application/json' },
  });
  if (resp.ok) {
    const data = await resp.json() as { account?: { name?: string; email?: string; plan_name?: string } };
    const acct = data.account;
    const detail = acct?.name ? `${acct.name}${acct.plan_name ? ` (${acct.plan_name})` : ''}` : 'connected';
    return { ok: true, message: `Kit connected — ${detail}.` };
  }
  const body = await resp.text().catch(() => '');
  const detail = body ? ': ' + body.slice(0, 200) : '';
  if (resp.status === 401) return { ok: false, message: `Kit: API key rejected — re-copy it from Kit → Settings → Developer.${detail}` };
  return { ok: false, message: `Kit: unexpected response (status ${resp.status})${detail}` };
}

async function checkDocuSeal(token: string): Promise<{ ok: boolean; message: string }> {
  const resp = await fetch('https://api.docuseal.com/templates?limit=5', {
    headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' },
  });
  if (resp.ok) {
    const data = await resp.json() as { data?: unknown[]; pagination?: { count?: number } };
    const count = data.pagination?.count ?? data.data?.length ?? '?';
    return { ok: true, message: `DocuSeal connected — ${count} template${count !== 1 ? 's' : ''} found.` };
  }
  if (resp.status === 401) return { ok: false, message: 'DocuSeal: token rejected — rotate your API token in DocuSeal settings.' };
  return { ok: false, message: `DocuSeal: unexpected response (status ${resp.status}) — try again in a moment.` };
}

async function checkResend(token: string): Promise<{ ok: boolean; message: string }> {
  if (!token) return { ok: false, message: 'Resend: no API key stored.' };
  if (!token.startsWith('re_')) return { ok: false, message: "Resend: key doesn't match expected format — Resend keys start with re_." };
  const resp = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.ok) {
    const data = await resp.json() as { data?: Array<{ name?: string }> };
    const domains = (data.data ?? []).map(d => d.name).filter(Boolean).join(', ');
    return { ok: true, message: `Resend connected — domains: ${domains || 'none configured'}.` };
  }
  if (resp.status === 401) return { ok: false, message: 'Resend: API key rejected — generate a new one in Resend → API Keys.' };
  return { ok: false, message: `Resend: unexpected response (status ${resp.status}) — try again in a moment.` };
}

function checkDrive(credential: string): { ok: boolean; message: string } {
  try {
    const parsed = JSON.parse(credential) as Record<string, unknown>;
    if (!parsed.client_email) return { ok: false, message: 'Google Drive: JSON is valid but missing client_email field.' };
    if (!parsed.private_key) return { ok: false, message: 'Google Drive: JSON is valid but missing private_key field.' };
    return { ok: true, message: `Google Drive: Service account ${String(parsed.client_email)} is configured.` };
  } catch {
    return { ok: false, message: 'Google Drive: Credential is not valid JSON. Paste the full service account JSON.' };
  }
}

async function checkInstantly(token: string): Promise<{ ok: boolean; message: string }> {
  // v2 uses Bearer token auth
  const resp = await fetch('https://api.instantly.ai/api/v2/accounts?limit=5', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (resp.ok) {
    const data = await resp.json() as { items?: Array<{ email?: string }> };
    const emails = (data.items ?? []).map(a => a.email).filter(Boolean);
    const summary = emails.length > 0 ? emails.slice(0, 2).join(', ') + (emails.length > 2 ? ` +${emails.length - 2} more` : '') : 'connected';
    return { ok: true, message: `Instantly connected — sending accounts: ${summary}.` };
  }

  // Fallback: v1 uses ?api_key= query param
  const resp1 = await fetch(`https://api.instantly.ai/api/v1/authenticate?api_key=${encodeURIComponent(token)}`);
  if (resp1.ok) return { ok: true, message: 'Instantly connected (v1 key).' };

  const body = await resp.text().catch(() => '');
  const detail = body ? ': ' + body.slice(0, 200) : '';
  if (resp.status === 401) return { ok: false, message: `Instantly: API key rejected — make sure you're using a V2 key from Instantly → Settings → Integrations → API.${detail}` };
  return { ok: false, message: `Instantly: unexpected response (status ${resp.status})${detail}` };
}

async function checkBraveSearch(token: string): Promise<{ ok: boolean; message: string }> {
  const resp = await fetch('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
    headers: { 'X-Subscription-Token': token, Accept: 'application/json' },
  });
  if (resp.ok) {
    await resp.json();
    return { ok: true, message: `Brave Search connected — API key valid.` };
  }
  if (resp.status === 401) return { ok: false, message: 'Brave Search: API key rejected — rotate it in your Brave dashboard.' };
  if (resp.status === 429) return { ok: true, message: 'Brave Search connected — rate limited but key is valid.' };
  return { ok: false, message: `Brave Search: unexpected response (status ${resp.status}) — try again in a moment.` };
}

async function checkGitHubPat(token: string): Promise<{ ok: boolean; message: string }> {
  const resp = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ops-dashboard',
    },
  });
  if (resp.ok) {
    const data = await resp.json() as { login?: string };
    return { ok: true, message: `GitHub PAT valid — authenticated as ${data.login ?? 'unknown'}.` };
  }
  if (resp.status === 401) return { ok: false, message: 'GitHub: PAT rejected — generate a new token at github.com/settings/tokens.' };
  return { ok: false, message: `GitHub: unexpected response (status ${resp.status}) — try again in a moment.` };
}

