import { layout, esc, relTime, durationStr, statusBadge, runtimeBadge } from './layout.js';
import type { Script, Run } from '../types.js';

export interface RunDetailData {
  script: Script;
  run: Run;
  appDomain: string;
  githubOwner: string;
  githubRepo: string;
  userEmail: string;
}

export function runDetailPage(d: RunDetailData): string {
  const { script, run, githubOwner, githubRepo, userEmail } = d;
  const ghBase = `https://github.com/${githubOwner}/${githubRepo}`;
  const versionLink = run.version_sha
    ? `<a href="${ghBase}/blob/${run.version_sha}/scripts/${esc(script.id)}/script.ts" target="_blank" rel="noopener" class="text-xs" style="font-family:var(--font-mono);">${esc(run.version_sha.slice(0, 7))}</a>`
    : '<span class="text-xs text-subtle">unknown</span>';

  const errorSection = run.status === 'failed' ? buildErrorSection(run) : '';

  const content = `
<div class="container">
  <div class="page-header">
    <div>
      <a href="/workflows/${esc(script.id)}" class="text-sm" style="color:var(--fg-muted);text-decoration:none;">&larr; ${esc(script.name)}</a>
      <h1 class="page-title" style="margin-top:6px;">Run detail</h1>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap;">
        ${statusBadge(run.status)}
        ${runtimeBadge(script.runtime)}
        <span class="text-xs text-subtle">Run ${esc(run.id.slice(0, 8))}&hellip;</span>
      </div>
    </div>
    ${(run.status === 'failed' || run.status === 'skipped') ? `
    <div class="page-actions">
      ${run.status === 'failed' ? `<button class="btn btn-primary" onclick="copyForClaude()">Copy for Claude</button>` : ''}
      <button class="btn btn-ghost" onclick="clearRun()">Clear</button>
    </div>` : ''}
  </div>

  ${errorSection}

  ${run.github_run_url ? `
  <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:var(--r-lg);padding:var(--s-4) var(--s-5);margin-bottom:var(--s-5);display:flex;align-items:center;justify-content:space-between;gap:var(--s-4);">
    <div>
      <div style="font-size:var(--t-sm);font-weight:700;margin-bottom:2px;">GitHub Actions job</div>
      <div style="font-size:var(--t-xs);color:var(--fg-muted);">Full logs, step timing, and raw output are available in GitHub Actions.</div>
    </div>
    <a href="${esc(run.github_run_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="white-space:nowrap;">View GitHub logs →</a>
  </div>` : (script.runtime === 'external' ? `
  <div style="background:#fef9c3;border:1.5px solid #fde047;border-radius:var(--r-lg);padding:var(--s-4) var(--s-5);margin-bottom:var(--s-5);">
    <div style="font-size:var(--t-sm);font-weight:700;margin-bottom:2px;">GitHub Actions logs pending</div>
    <div style="font-size:var(--t-xs);color:var(--fg-muted);">The job is running. This page will show a link once GitHub reports back.</div>
  </div>` : '')}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s-5);margin-bottom:var(--s-8);">
    ${metaCard('Started', run.started_at ? relTime(run.started_at) : '—')}
    ${metaCard('Duration', durationStr(run.duration_ms))}
    ${metaCard('Trigger', `${esc(run.trigger_type)}${run.trigger_detail ? ` — ${esc(run.trigger_detail)}` : ''}`)}
    ${metaCard('Version', versionLink)}
    ${run.triggered_by ? metaCard('Triggered by', esc(run.triggered_by)) : ''}
    ${run.ended_at ? metaCard('Ended', relTime(run.ended_at)) : ''}
  </div>

  <div class="section">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--s-4);">
      <span class="section-title" style="margin-bottom:0;">Verbose log</span>
      ${run.version_sha ? `<a href="${ghBase}/blob/${run.version_sha}/scripts/${esc(script.id)}/script.ts" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">View source on GitHub</a>` : ''}
    </div>
    <div class="log-viewer" id="log-viewer">
      <div id="log-loading" style="color:#6c7086;font-style:italic;">Loading log…</div>
    </div>
  </div>
</div>

<script>
const RUN_ID = ${JSON.stringify(run.id)};
const SCRIPT_ID = ${JSON.stringify(script.id)};

(async function loadLog() {
  const viewer = document.getElementById('log-viewer');
  const loading = document.getElementById('log-loading');
  try {
    const res = await fetch('/api/runs/' + RUN_ID + '/log');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    loading.remove();
    if (!data.steps || data.steps.length === 0) {
      viewer.innerHTML = '<span style="color:#6c7086;font-style:italic;">No log steps recorded.</span>';
      return;
    }
    renderLog(viewer, data.steps);
  } catch (err) {
    loading.textContent = 'Could not load log: ' + err.message;
    loading.style.color = '#f38ba8';
  }
})();

function renderLog(viewer, steps) {
  const sections = groupSections(steps);
  let html = '';
  for (const section of sections) {
    const isCollapsible = section.steps.length > 3;
    const id = 'sec-' + Math.random().toString(36).slice(2);
    if (isCollapsible) {
      html += '<details style="margin-bottom:4px;">';
      html += '<summary style="cursor:pointer;color:#89dceb;font-size:12px;padding:2px 0;user-select:none;">' +
        escHtml(section.label) + ' <span style="color:#6c7086;">(' + section.steps.length + ' steps)</span></summary>';
    }
    for (const step of section.steps) {
      html += renderStep(step);
    }
    if (isCollapsible) html += '</details>';
  }
  viewer.innerHTML = html;
}

function groupSections(steps) {
  // Group consecutive same-type steps into collapsible sections
  if (steps.length <= 8) return [{ label: 'All steps', steps }];
  const sections = [];
  let current = null;
  for (const step of steps) {
    const sectionKey = step.type === 'api_call' || step.type === 'api_response' ? 'api' : step.type;
    if (!current || current.key !== sectionKey) {
      if (current) sections.push(current);
      current = { key: sectionKey, label: labelForType(sectionKey), steps: [] };
    }
    current.steps.push(step);
  }
  if (current) sections.push(current);
  return sections;
}

function labelForType(t) {
  const map = { api: 'API calls', info: 'Info', error: 'Error', success: 'Success', api_call: 'API request', api_response: 'API response' };
  return map[t] || t;
}

function renderStep(step) {
  const d = new Date(step.ts);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, fractionalSecondDigits: 3,
  }).formatToParts(d);
  const getPart = function(t) { const p = parts.find(function(x){return x.type===t;}); return p ? p.value : '00'; };
  const ts = getPart('hour') + ':' + getPart('minute') + ':' + getPart('second') + '.' + getPart('fractionalSecond');
  const typeClass = 'log-type-' + step.type;
  const typeLabel = step.type.replace(/_/g, ' ').toUpperCase();
  const detailHtml = step.detail ? '<div class="log-detail">' + escHtml(JSON.stringify(step.detail, null, 2)) + '</div>' : '';
  const dur = step.duration_ms != null ? ' <span style="color:#6c7086;">(' + step.duration_ms + 'ms)</span>' : '';
  const status = step.status_code != null ? ' <span style="color:#a6e3a1;">HTTP ' + step.status_code + '</span>' : '';
  return '<div class="log-step"><span class="log-ts">' + escHtml(ts) + '</span>' +
    '<span class="log-type ' + typeClass + '">' + escHtml(typeLabel) + '</span>' +
    '<span class="log-msg">' + escHtml(step.message) + dur + status + '</span>' +
    '</div>' + detailHtml;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showFlash(msg, type) {
  const el = document.createElement('div');
  el.className = 'flash ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function clearRun() {
  const res = await fetch('/api/runs/' + RUN_ID, { method: 'DELETE' });
  if (res.ok) {
    location.href = '/workflows/' + SCRIPT_ID;
  } else {
    showFlash("Couldn't clear that run — refresh and try again.", 'error');
  }
}

async function copyForClaude() {
  const btn = document.querySelector('.btn-primary');
  btn.disabled = true;
  btn.textContent = 'Building payload…';
  try {
    const res = await fetch('/api/runs/' + RUN_ID + '/copy-for-claude', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    await navigator.clipboard.writeText(data.payload);
    btn.textContent = 'Copied!';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = 'Copy for Claude'; }, 3000);
  } catch (err) {
    btn.textContent = "Couldn't copy — retry";
    btn.disabled = false;
    showFlash("Couldn't build the Claude payload — try again, or refresh if it keeps failing.", 'error');
    console.error(err);
  }
}
</script>
`;

  return layout(content, { title: `Run — ${script.name}`, activeNav: 'dashboard', userEmail });
}

function metaCard(label: string, value: string): string {
  return `
<div class="card" style="padding:var(--s-4) var(--s-5);">
  <div class="text-xs text-muted" style="margin-bottom:4px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">${label}</div>
  <div class="text-sm" style="font-weight:600;">${value}</div>
</div>`;
}

function buildErrorSection(run: Run): string {
  const errorMessages: Record<string, string> = {
    auth: 'An API key expired or was revoked. The workflow couldn\'t authenticate with one of its connected services. Go to Settings → Connections and rotate the affected key.',
    rate_limit: 'The workflow hit a rate limit from an external API. This typically resolves on its own — the next scheduled run should succeed. If it keeps happening, check if another process is also calling the same API.',
    network: 'A network error occurred while calling an external service. This is usually transient — a temporary outage or DNS issue. The next scheduled run should succeed.',
    schema: 'The workflow received data in an unexpected format from an external API. The API may have changed its response structure. Use "Copy for Claude" to diagnose and fix the script.',
    unknown: 'An unexpected error occurred. Use "Copy for Claude" to send the full log and source code to Claude for diagnosis.',
  };

  const category = run.error_category ?? 'unknown';
  const explanation = errorMessages[category] ?? errorMessages.unknown;
  const summary = run.error_summary ?? 'No error summary available.';

  return `
<div style="background:var(--danger-soft);border:1.5px solid #fca5a5;border-radius:var(--r-lg);padding:var(--s-6);margin-bottom:var(--s-8);">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s-4);flex-wrap:wrap;">
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:var(--s-3);margin-bottom:var(--s-3);">
        <span style="width:10px;height:10px;border-radius:50%;background:var(--danger);flex-shrink:0;"></span>
        <strong style="color:var(--danger);font-size:var(--t-sm);">${esc(categoryLabel(category))}</strong>
      </div>
      <p class="text-sm" style="margin-bottom:var(--s-3);font-family:var(--font-mono);background:var(--ll-white);padding:var(--s-3) var(--s-4);border-radius:var(--r-sm);border:1px solid #fca5a5;">${esc(summary)}</p>
      <div style="background:var(--ll-white);border-radius:var(--r-sm);border:1px solid var(--border);padding:var(--s-4);">
        <p class="text-xs" style="font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--fg-muted);margin-bottom:var(--s-2);">What does this error mean?</p>
        <p class="text-sm">${esc(explanation)}</p>
      </div>
    </div>
    <button class="btn btn-primary" onclick="copyForClaude()" style="flex-shrink:0;">Copy for Claude</button>
  </div>
</div>`;
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    auth: 'API authentication error',
    rate_limit: 'Rate limit exceeded',
    network: 'Network error',
    schema: 'Data format mismatch',
    unknown: 'Unexpected error',
  };
  return labels[cat] ?? cat;
}
