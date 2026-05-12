import { layout, esc, relTime, modal, statusBadge } from './layout.js';
import type { UsageSnapshot } from '../types.js';

export interface SettingsData {
  tab: 'connections' | 'notifications' | 'account';
  secrets: Array<{ service: string; last_rotated_at: string | null }>;
  usage: UsageSnapshot[];
  userEmail: string;
  notifyEmails: string[];
}

// Examples of common integrations. Add or remove entries to match the services
// your scripts use. The `service` key is what scripts reference via
// `ctx.secrets.<key>` (and what `required_secrets` in metadata.json lists).
const SERVICE_INFO: Record<string, {
  label: string;
  hint: string;
  howTo: string;
  link: string;
  isJson?: boolean;
}> = {
  hubspot: {
    label: 'HubSpot',
    hint: 'Private App access token (starts with pat-na1-)',
    howTo: 'In HubSpot → Settings → Integrations → Private Apps, create a new Private App with the CRM scopes your scripts need (e.g. crm.objects.contacts.read, crm.objects.deals.write). Copy the access token shown after creation — it is only shown once.',
    link: 'https://app.hubspot.com/private-apps',
  },
  kit: {
    label: 'Kit (ConvertKit)',
    hint: 'Kit API v4 secret key',
    howTo: 'Log in to Kit → Account Settings → Developer → API Keys. Click "Add API Key" and copy the secret key.',
    link: 'https://app.kit.com/account_settings/developer_settings',
  },
  instantly: {
    label: 'Instantly',
    hint: 'Instantly v2 API key',
    howTo: 'Log in to Instantly → Settings → Integrations → API. Generate a V2 API key and copy it.',
    link: 'https://app.instantly.ai/app/settings/integrations',
  },
  docuseal: {
    label: 'DocuSeal',
    hint: 'DocuSeal API token',
    howTo: 'Log in to DocuSeal → Settings → API. Copy the API token.',
    link: 'https://console.docuseal.com/api',
  },
  drive: {
    label: 'Google Drive',
    hint: 'Service account JSON (paste the full JSON object)',
    howTo: 'In Google Cloud Console → IAM & Admin → Service Accounts, create a service account. Generate a JSON key. Paste the entire JSON object here. Then share any Drive folders with the service account email so it can read them.',
    link: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
    isJson: true,
  },
  resend: {
    label: 'Resend',
    hint: 'Resend API key (starts with re_)',
    howTo: 'Log in to Resend → API Keys → Create API Key. Select "Sending access" and restrict to the domain you send from. Copy the key.',
    link: 'https://resend.com/api-keys',
  },
  brave_search: {
    label: 'Brave Search',
    hint: 'Brave Search API key',
    howTo: 'Sign up at brave.com/search/api. Create a subscription (free tier available) and copy your API key.',
    link: 'https://api.search.brave.com/app/keys',
  },
  github_pat: {
    label: 'GitHub Personal Access Token',
    hint: 'GitHub PAT with repo + workflow scopes',
    howTo: 'Go to GitHub → Settings → Developer Settings → Personal Access Tokens. Create a classic token with repo + workflow scopes (or a fine-grained token scoped to your repo with Actions: write + Contents: write + Pull requests: write). This powers the paste-back deploy flow.',
    link: 'https://github.com/settings/tokens?type=beta',
  },
};

// Order shown on the Settings page. Add/remove entries to match the services
// your scripts actually use.
const DISPLAY_ORDER = ['hubspot', 'kit', 'instantly', 'docuseal', 'drive', 'resend', 'brave_search', 'github_pat'];

export function settingsPage(d: SettingsData): string {
  const { tab, secrets, usage, userEmail } = d;

  const secretMap = new Map(secrets.map(s => [s.service, s]));

  const tabs = `
<div style="display:flex;gap:2px;margin-bottom:var(--s-8);background:var(--bg-sunken);padding:4px;border-radius:var(--r-lg);width:fit-content;">
  ${(['connections', 'notifications', 'account'] as const).map(t =>
    `<a href="/settings/${t}" class="btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost'}" style="border-radius:var(--r-md);">${tabLabel(t)}</a>`
  ).join('')}
</div>`;

  let tabContent = '';
  if (tab === 'connections') {
    tabContent = buildConnectionsTab(secretMap);
  } else if (tab === 'notifications') {
    tabContent = buildNotificationsTab(d.notifyEmails);
  } else {
    tabContent = buildAccountTab(usage, userEmail);
  }

  const modals = tab === 'connections' ? buildCredentialModals() : '';

  const content = `
<div class="container">
  <div class="page-header">
    <div>
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Manage connections, notification preferences, and account details.</p>
    </div>
  </div>
  ${tabs}
  ${tabContent}
</div>
${modals}
`;

  return layout(content, { title: 'Settings', activeNav: 'settings', userEmail });
}

function tabLabel(t: string): string {
  const labels: Record<string, string> = { connections: 'Connections', notifications: 'Notifications', account: 'Account' };
  return labels[t] ?? t;
}

function buildConnectionsTab(secretMap: Map<string, { service: string; last_rotated_at: string | null }>): string {
  const cards = DISPLAY_ORDER.map(svc => {
    const info = SERVICE_INFO[svc];
    if (!info) return '';
    const secret = secretMap.get(svc);
    const hasKey = !!secret;
    const rotated = secret?.last_rotated_at ? `Updated ${relTime(secret.last_rotated_at)}` : 'Never set';

    return `
<div class="conn-card">
  <div class="conn-card-header">
    <span class="conn-card-title">${esc(info.label)}</span>
    <span class="conn-rotated">${esc(rotated)}</span>
  </div>
  <div class="conn-card-actions">
    <span class="conn-status ${hasKey ? 'checking' : 'bad'}" id="status-${esc(svc)}">${hasKey ? 'Checking…' : 'Not connected'}</span>
    <button class="btn btn-ghost btn-sm conn-recheck" onclick="recheckStatus('${esc(svc)}')" title="Recheck">&#x21bb;</button>
    <button class="btn btn-ghost btn-sm" data-modal="cred-modal-${esc(svc)}">Edit</button>
  </div>
  <div class="conn-msg" id="msg-${esc(svc)}" style="display:none;"></div>
</div>`;
  }).join('');

  return `
<div class="section">
  <div class="section-title">API connections</div>
  <div class="conn-grid">
    ${cards}
  </div>
</div>

<script>
async function recheckStatus(svc) {
  const el = document.getElementById('status-' + svc);
  const msg = document.getElementById('msg-' + svc);
  if (el) { el.className = 'conn-status checking'; el.textContent = 'Checking…'; }
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  try {
    const res = await fetch('/api/secrets/' + svc + '/status');
    const data = await res.json();
    if (el) {
      el.className = 'conn-status ' + (data.ok ? 'ok' : 'bad');
      el.textContent = data.ok ? 'Connected' : 'Not connected';
    }
    if (msg && data.message) {
      msg.textContent = data.message;
      msg.style.display = 'block';
    }
  } catch (e) {
    if (el) { el.className = 'conn-status bad'; el.textContent = "Couldn't check"; }
    if (msg) { msg.textContent = "We couldn't reach the connection check — refresh to retry."; msg.style.display = 'block'; }
    console.error(e);
  }
}

// Check live connection status for all services on load
(async () => {
  const services = ${JSON.stringify(DISPLAY_ORDER)};
  for (const svc of services) {
    recheckStatus(svc);
  }
})();

function toggleShow(svc) {
  const inp = document.getElementById('cred-input-' + svc);
  const btn = document.getElementById('show-btn-' + svc);
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = 'Hide';
  } else {
    inp.type = 'password';
    btn.textContent = 'Show';
  }
}

async function saveCredential(svc) {
  const val = document.getElementById('cred-input-' + svc).value.trim();
  if (!val) { showSettingsFlash('Please enter a value.', 'error'); return; }
  const res = await fetch('/api/secrets/' + svc, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ value: val })
  });
  if (res.ok) {
    document.getElementById('cred-modal-' + svc)?.classList.remove('open');
    showSettingsFlash('Credential saved.', 'success');
    recheckStatus(svc);
  } else {
    showSettingsFlash('Failed to save credential.', 'error');
  }
}

function showSettingsFlash(msg, type) {
  const el = document.createElement('div');
  el.className = 'flash ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
</script>`;
}

function buildCredentialModals(): string {
  return DISPLAY_ORDER.map(svc => {
    const info = SERVICE_INFO[svc];
    if (!info) return '';
    const isJson = !!info.isJson;
    const inputEl = isJson
      ? `<textarea class="form-input" id="cred-input-${esc(svc)}" placeholder='{"type":"service_account",...}' style="min-height:160px;font-size:12px;"></textarea>`
      : `<div style="display:flex;gap:8px;align-items:center;">
          <input class="form-input" type="password" id="cred-input-${esc(svc)}" placeholder="${esc(info.hint)}" style="flex:1;">
          <button class="btn btn-ghost btn-sm" id="show-btn-${esc(svc)}" onclick="toggleShow('${esc(svc)}')" type="button">Show</button>
        </div>`;

    return modal(`cred-modal-${svc}`, `Edit — ${info.label}`,
      `<div class="form-group">
        <label class="form-label">${esc(info.hint)}</label>
        ${inputEl}
        ${!isJson ? `<p class="form-hint">The value is stored encrypted. Existing value is never shown.</p>` : ''}
      </div>
      <details style="margin-bottom:var(--s-5);">
        <summary class="text-sm" style="cursor:pointer;font-weight:600;color:var(--fg-muted);padding:var(--s-2) 0;">How do I get this key?</summary>
        <div style="margin-top:var(--s-3);padding:var(--s-4);background:var(--bg-sunken);border-radius:var(--r-md);">
          <p class="text-sm" style="margin-bottom:var(--s-3);">${esc(info.howTo)}</p>
          <a href="${esc(info.link)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Open ${esc(info.label)} settings &rarr;</a>
        </div>
      </details>
      <div style="display:flex;gap:var(--s-3);">
        <button class="btn btn-primary btn-full" onclick="saveCredential('${esc(svc)}')">Save</button>
        <button class="btn btn-ghost" data-close-modal>Cancel</button>
      </div>`
    );
  }).join('\n');
}

function buildNotificationsTab(notifyEmails: string[]): string {
  // List of people who can receive failure emails. The toggle persists per email
  // in the `settings` table (key: 'notify_emails'). The list below is just the
  // initial roster shown in the UI — edit this list to match your team. If
  // someone is missing here, they can't be toggled on from the UI; add them.
  // To enable on day one: replace the example users below with your real users.
  const ALL_USERS: Array<{ name: string; email: string }> = [
    // { name: 'Your Name', email: 'you@example.com' },
  ];

  if (ALL_USERS.length === 0) {
    return `
<div class="section">
  <div class="section-title">Failure email recipients</div>
  <div class="card">
    <p class="text-sm" style="margin-bottom:var(--s-3);">No recipients are configured yet.</p>
    <p class="text-xs text-muted">Edit <code>ALL_USERS</code> in <code>src/frontend/settings.ts</code> to add team members. Each toggled-on user gets emailed when a workflow fails.</p>
  </div>
</div>`;
  }

  const rows = ALL_USERS.map(u => {
    const enabled = notifyEmails.includes(u.email);
    return `
<div class="card" style="margin-bottom:var(--s-4);">
  <div class="service-card">
    <div style="flex:1;min-width:0;">
      <div class="service-name">${esc(u.name)}</div>
      <div class="conn-rotated">${esc(u.email)}</div>
    </div>
    <label class="toggle" title="Toggle failure emails for ${esc(u.name)}">
      <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleNotify('${esc(u.email)}', this.checked)">
      <span class="toggle-track"></span>
    </label>
  </div>
</div>`;
  }).join('');

  return `
<div class="section">
  <div class="section-title">Failure email recipients</div>
  ${rows}
  <div style="display:flex;gap:var(--s-3);margin-top:var(--s-5);">
    <a class="btn btn-ghost btn-sm" href="/settings/notifications/preview">Preview sample failure email</a>
  </div>
  <p class="form-hint" style="margin-top:var(--s-3);">Failure emails are sent when a workflow fails. They include a link to the Run detail page. No API payloads or credentials are ever included.</p>
</div>

<script>
async function toggleNotify(email, enabled) {
  try {
    const res = await fetch('/api/settings/notify-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, enabled }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showNotifFlash((enabled ? 'Enabled' : 'Disabled') + ' failure emails for ' + email, 'success');
  } catch (e) {
    showNotifFlash("Couldn't save that change — try again in a moment.", 'error');
    console.error(e);
  }
}
function showNotifFlash(msg, type) {
  const el = document.createElement('div');
  el.className = 'flash ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
</script>`;
}

export function notificationPreviewPage(userEmail: string): string {
  const content = `
<div class="container" style="max-width:640px;">
  <div class="page-header">
    <div>
      <h1 class="page-title">Sample failure email</h1>
      <p class="page-subtitle">This is what a workflow failure notification looks like.</p>
    </div>
    <a class="btn btn-ghost btn-sm" href="/settings/notifications">&larr; Back</a>
  </div>
  <div class="card" style="border-left:4px solid var(--danger);padding:var(--s-6);">
    <p class="text-xs text-muted" style="margin-bottom:var(--s-4);">From: ops@example.com &nbsp;·&nbsp; To: (configured recipients)</p>
    <p class="text-sm" style="font-weight:var(--w-bold);margin-bottom:var(--s-2);">Subject: Workflow failed: Hello World</p>
    <hr style="border:none;border-top:1px solid var(--border);margin:var(--s-4) 0;">
    <p class="text-sm" style="margin-bottom:var(--s-3);">A workflow run failed at <strong>Monday, January 8 2026 at 9:02 AM</strong>.</p>
    <div class="card" style="background:var(--bg-sunken);margin-bottom:var(--s-4);">
      <div style="display:flex;align-items:center;gap:var(--s-3);margin-bottom:var(--s-2);">
        <strong class="text-sm">Hello World</strong>
        ${statusBadge('failed')}
      </div>
      <p class="text-xs text-muted">Triggered by: cron &nbsp;·&nbsp; Duration: 8.4s</p>
    </div>
    <p class="text-sm" style="margin-bottom:var(--s-2);font-weight:var(--w-semi);">Error</p>
    <pre style="background:var(--bg-sunken);padding:var(--s-3);border-radius:var(--r-sm);font-size:11px;overflow-x:auto;white-space:pre-wrap;">Error: connection refused — example.com:443</pre>
    <div style="margin-top:var(--s-5);">
      <a class="btn btn-primary btn-sm" href="#">View run details &rarr;</a>
    </div>
    <p class="text-xs text-muted" style="margin-top:var(--s-5);">No credentials or API payloads are ever included in these emails. Manage notification recipients in <a href="/settings/notifications">Settings → Notifications</a>.</p>
  </div>
</div>`;
  return layout(content, { title: 'Email Preview', activeNav: 'settings', userEmail });
}

function buildAccountTab(usage: UsageSnapshot[], userEmail: string): string {
  const usageRows = usage.map(u => {
    const pct = Math.min(u.pct, 100);
    const barClass = pct >= 95 ? 'red' : pct >= 80 ? 'yellow' : '';
    return `
<tr>
  <td>${esc(u.resource.replace(/_/g, ' '))}</td>
  <td>${esc(String(u.count))}</td>
  <td>${esc(String(u.limit))}</td>
  <td>
    <div style="display:flex;align-items:center;gap:10px;">
      <div class="usage-bar" style="width:100px;"><div class="usage-bar-fill ${barClass}" style="width:${pct}%;"></div></div>
      <span class="text-xs">${pct}%</span>
    </div>
  </td>
</tr>`;
  }).join('');

  return `
<div class="section">
  <div class="section-title">Authorized users</div>
  <div class="card">
    <p class="text-sm" style="margin-bottom:var(--s-4);">Access is controlled by Cloudflare Access. To add or remove users, edit the Access application policy in the Cloudflare Zero Trust dashboard.</p>
    <p class="text-xs text-muted">The signed-in account for this session: <strong>${esc(userEmail ?? '(unknown)')}</strong></p>
    <a href="https://one.dash.cloudflare.com/" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="margin-top:var(--s-5);">Manage in Cloudflare Access &rarr;</a>
  </div>
</div>

<div class="section">
  <div class="section-title">Plan</div>
  <div class="card" style="display:flex;align-items:center;gap:var(--s-5);">
    <div style="background:var(--ll-teal-soft);color:var(--ll-teal-deep);font-weight:700;font-size:var(--t-sm);padding:6px 18px;border-radius:var(--r-pill);">Cloudflare Workers Free</div>
    <div>
      <p class="text-sm" style="font-weight:600;">Free tier</p>
      <p class="text-xs text-muted">100k requests/day, 100k D1 writes/day, 1k KV writes/day, 10k queue ops/day, 1M R2 ops/month.</p>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Usage today</div>
  <div class="card" style="padding:0;">
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Resource</th>
          <th>Used</th>
          <th>Daily limit</th>
          <th>Usage</th>
        </tr></thead>
        <tbody>
          ${usageRows || '<tr><td colspan="4" class="text-muted text-sm" style="text-align:center;padding:24px;">No usage data yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
</div>`;
}
