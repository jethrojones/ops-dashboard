import { layout, esc, relTime, durationStr, statusBadge, runtimeBadge, modal } from './layout.js';
import type { Script, Run, UsageSnapshot } from '../types.js';

// Worker scheduler only ticks 5–23 UTC. Outside that window, due jobs sit with
// next_run_at in the past until the scheduler resumes — show "Pending" not "X ago".
function nextRunLabel(nextRunAt?: string | null): string {
  if (!nextRunAt) return 'Not scheduled';
  if (new Date(nextRunAt).getTime() <= Date.now()) return 'Pending';
  return relTime(nextRunAt);
}

interface DashboardData {
  scripts: (Script & { last_run?: Run; next_run_at?: string | null })[];
  recentRuns: (Run & { script_name: string })[];
  usage: UsageSnapshot[];
  userEmail: string;
}

export function dashboardPage(d: DashboardData): string {
  const failed = d.recentRuns.filter(r => r.status === 'failed').length;
  const skipped = d.recentRuns.filter(r => r.status === 'skipped').length;
  const ok = d.recentRuns.filter(r => r.status === 'success').length;

  let bannerClass = 'green';
  let bannerMsg = 'Everything is running successfully.';
  if (failed > 0) {
    bannerClass = 'red';
    bannerMsg = `${failed} workflow${failed > 1 ? 's' : ''} failed — see details below`;
  } else if (skipped > 0) {
    bannerClass = 'yellow';
    bannerMsg = `${ok} workflow${ok !== 1 ? 's' : ''} succeeded, ${skipped} skipped`;
  }

  // Sort scripts: next-running first, then never-scheduled, alphabetical within groups
  const sorted = [...d.scripts].sort((a, b) => {
    if (a.next_run_at && b.next_run_at) return a.next_run_at < b.next_run_at ? -1 : 1;
    if (a.next_run_at) return -1;
    if (b.next_run_at) return 1;
    return a.name.localeCompare(b.name);
  });

  const stackCards = sorted.map((s, i) => workflowStackCard(s, i)).join('');
  const listRows = sorted.map(s => workflowListRow(s)).join('');
  const gridCards = sorted.map(s => workflowCard(s)).join('');

  const feedRows = d.recentRuns.map(r => `
    <div class="feed-row-wrap" id="feed-row-${esc(r.id)}">
      <a class="feed-row${r.status === 'failed' ? ' failed' : ''}" href="/workflows/${esc(r.script_id)}/runs/${esc(r.id)}">
        <span class="feed-name">${esc(r.script_name)}</span>
        ${statusBadge(r.status)}
        <span class="feed-meta">${esc(r.trigger_type)}</span>
        <span class="feed-meta">${relTime(r.started_at)}</span>
        <span class="feed-dur">${durationStr(r.duration_ms)}</span>
      </a>${(r.status === 'failed' || r.status === 'skipped') ? `
      <button class="btn btn-ghost btn-sm" style="margin-left:var(--s-3);flex-shrink:0;" onclick="clearRun('${esc(r.id)}')">Clear</button>` : ''}
    </div>`).join('');

  const usageBars = d.usage.map(u => {
    const pct = Math.min(u.pct, 100);
    const fillClass = pct >= 95 ? 'red' : pct >= 80 ? 'yellow' : '';
    const label = pct < 1 && u.count > 0 ? `${u.count}` : `${pct}%`;
    return `<span class="usage-item">
      <span>${esc(u.resource.replace(/_/g, ' '))}</span>
      <span class="usage-bar"><span class="usage-bar-fill ${fillClass}" style="width:${Math.max(pct, u.count > 0 ? 1 : 0)}%"></span></span>
      <span>${esc(label)}</span>
    </span>`;
  }).join('');

  const total = sorted.length;

  const content = `
<div class="container">
  <div class="page-header" style="align-items:flex-end;">
    <div>
      <h1 class="page-title">Workflows</h1>
      <p class="page-subtitle">All automations at a glance.</p>
    </div>
    <div class="view-toggle-bar">
      <button class="view-btn" id="btn-view-stack" onclick="setView('stack')" title="Stack view">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="9" rx="2" fill="currentColor" opacity=".3"/><rect x="2" y="2" width="12" height="9" rx="2" fill="currentColor"/></svg>
      </button>
      <button class="view-btn" id="btn-view-list" onclick="setView('list')" title="List view">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="2" rx="1" fill="currentColor"/><rect x="2" y="7" width="12" height="2" rx="1" fill="currentColor"/><rect x="2" y="11" width="12" height="2" rx="1" fill="currentColor"/></svg>
      </button>
      <button class="view-btn" id="btn-view-grid" onclick="setView('grid')" title="Grid view">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor"/><rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor"/><rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor"/><rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor"/></svg>
      </button>
    </div>
  </div>

  <div class="status-banner ${bannerClass}">
    <span class="indicator"></span>
    <span>${esc(bannerMsg)}</span>
    ${failed > 0 ? `<button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="clearAllFailed()">Clear all failed</button>` : ''}
  </div>

  <!-- Stack view -->
  <div id="view-stack" class="dash-view">
    <div class="stack-deck" id="stack-deck">
      ${stackCards}
    </div>
    <div class="stack-nav">
      <button class="btn btn-ghost btn-sm" onclick="stackPrev()">&#8592;</button>
      <span class="stack-counter" id="stack-counter">1–${Math.min(3, total)} of ${total}</span>
      <button class="btn btn-ghost btn-sm" onclick="stackNext()">&#8594;</button>
    </div>
  </div>

  <!-- List view -->
  <div id="view-list" class="dash-view" style="display:none;">
    <div class="card" style="overflow:hidden;">
      <table class="workflow-list-table">
        <thead><tr>
          <th>Workflow</th>
          <th>Status</th>
          <th>Last run</th>
          <th>Next run</th>
          <th></th>
        </tr></thead>
        <tbody>${listRows}</tbody>
      </table>
    </div>
  </div>

  <!-- Grid view -->
  <div id="view-grid" class="dash-view" style="display:none;">
    <div class="card-grid">${gridCards}</div>
  </div>

  <div class="section">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--s-3);">
      <div class="section-title" style="margin-bottom:0;">Recent activity</div>
      <a href="/runs" class="btn btn-ghost btn-sm">View all runs &rarr;</a>
    </div>
    <div class="card">
      <div class="feed">
        ${feedRows || '<p class="text-muted text-sm" style="padding:16px 0;">No runs yet.</p>'}
      </div>
    </div>
  </div>
</div>

<footer class="usage-footer">
  <span style="font-weight:700;color:var(--fg-muted);">Cloudflare usage today</span>
  ${usageBars || '<span class="text-xs">Loading...</span>'}
</footer>

${runNowModal()}
`;

  return layout(content, { title: 'Dashboard', activeNav: 'dashboard', userEmail: d.userEmail });
}

function workflowStackCard(s: Script & { last_run?: Run; next_run_at?: string | null }, idx: number): string {
  const lr = s.last_run;
  const accent = lr
    ? (lr.status === 'failed' ? 'var(--danger)' : lr.status === 'running' ? 'var(--running)' : lr.status === 'skipped' ? 'var(--warning)' : 'var(--ll-teal-deep)')
    : 'var(--ll-teal-deep)';
  const lastRunText = lr ? relTime(lr.started_at) : 'Never run';
  const nextRunText = nextRunLabel(s.next_run_at);

  return `
<div class="stack-card" id="stack-card-${idx}" style="border-top-color:${accent};">
  <div class="stack-card-header">
    <div style="flex:1;min-width:0;">
      <h3 class="stack-card-name">${esc(s.name)}</h3>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
      ${runtimeBadge(s.runtime)}
      <label class="toggle" title="${s.enabled ? 'Pause workflow' : 'Resume workflow'}">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleWorkflow('${esc(s.id)}', this.checked)">
        <span class="toggle-track"></span>
      </label>
    </div>
  </div>
  <div class="stack-card-status">
    ${lr ? statusBadge(lr.status) : '<span class="stack-card-no-run">No runs yet</span>'}
    <span class="stack-card-ts">${esc(lastRunText)}</span>
  </div>
  <div class="stack-card-next">Next: ${esc(nextRunText)}</div>
  <div class="stack-card-actions">
    <button class="btn btn-run btn-sm" onclick="runNow('${esc(s.id)}', '${esc(s.name)}')">Run now</button>
    <a class="btn btn-ghost btn-sm" href="/workflows/${esc(s.id)}">Details</a>
    <a class="btn btn-edit btn-sm" href="/workflows/${esc(s.id)}/edit">Edit</a>
  </div>
</div>`;
}

function workflowListRow(s: Script & { last_run?: Run; next_run_at?: string | null }): string {
  const lr = s.last_run;
  const lastRunText = lr ? relTime(lr.started_at) : '—';
  const nextRunText = s.next_run_at ? nextRunLabel(s.next_run_at) : '—';
  const statusCell = lr
    ? statusBadge(lr.status)
    : '<span class="text-subtle" style="font-size:var(--t-xs);">—</span>';
  return `<tr>
    <td><a href="/workflows/${esc(s.id)}" class="workflow-list-name">${esc(s.name)}</a></td>
    <td>${statusCell}</td>
    <td class="text-sm text-muted">${esc(lastRunText)}</td>
    <td class="text-sm text-muted">${esc(nextRunText)}</td>
    <td style="text-align:right;white-space:nowrap;">
      <button class="btn btn-run btn-sm" onclick="runNow('${esc(s.id)}', '${esc(s.name)}')">Run</button>
      <a class="btn btn-ghost btn-sm" href="/workflows/${esc(s.id)}/edit" style="margin-left:4px;">Edit</a>
    </td>
  </tr>`;
}

function workflowCard(s: Script & { last_run?: Run; next_run_at?: string | null }, stackIndex?: number): string {
  const lr = s.last_run;
  const lastRunText = lr
    ? `Last run ${relTime(lr.started_at)}`
    : 'Never run';
  const nextRunText = s.next_run_at
    ? `Next: ${nextRunLabel(s.next_run_at)}`
    : '';
  const statusDot = lr ? `<span class="badge ${lr.status}" style="margin-left:auto">${lr.status}</span>` : '';
  const stackAttr = stackIndex !== undefined ? ` data-stack-idx="${stackIndex}"` : '';

  return `
<div class="card workflow-card"${stackAttr}>
  <div class="workflow-card-top">
    <div style="flex:1;min-width:0;">
      <h2 class="workflow-name">${esc(s.name)}</h2>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
      ${runtimeBadge(s.runtime)}
      <label class="toggle" title="${s.enabled ? 'Pause workflow' : 'Resume workflow'}">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleWorkflow('${esc(s.id)}', this.checked)">
        <span class="toggle-track"></span>
      </label>
    </div>
  </div>
  <p class="workflow-desc">${esc(s.description)}</p>
  <div class="workflow-meta">
    ${statusDot}
    <span>${esc(lastRunText)}</span>
    ${nextRunText ? `<span>${esc(nextRunText)}</span>` : ''}
  </div>
  <div class="workflow-actions">
    <button class="btn btn-run btn-sm" onclick="runNow('${esc(s.id)}', '${esc(s.name)}')">Run now</button>
    <a class="btn btn-ghost btn-sm" href="/workflows/${esc(s.id)}">Details</a>
    <a class="btn btn-edit btn-sm" href="/workflows/${esc(s.id)}/edit">Edit</a>
    <button class="info-btn" data-modal="info-${esc(s.id)}" title="What does this do?">i</button>
  </div>
</div>
${modal(`info-${s.id}`, s.name, `<p class="t-body">${esc(s.description)}</p><p class="text-xs text-muted" style="margin-top:16px;">Runtime: ${runtimeBadge(s.runtime)}</p>`)}
`;
}

function runNowModal(): string {
  return `
${modal('run-now-modal', 'Run workflow', `
  <p class="t-body" id="run-now-desc"></p>
  <div class="form-group" id="run-now-input-group" style="display:none;">
    <label class="form-label" for="run-now-input">Input (optional)</label>
    <input class="form-input" id="run-now-input" placeholder="e.g. HubSpot deal URL or ID">
    <p class="form-hint">Paste a HubSpot deal URL and the ID will be extracted automatically.</p>
  </div>
  <div style="display:flex;gap:12px;margin-top:24px;">
    <button class="btn btn-run btn-full" id="run-now-confirm">Run now</button>
    <button class="btn btn-ghost" data-close-modal>Cancel</button>
  </div>
`)}
<script>
// ── Stack view ───────────────────────────────────────────────────────────────
let _stackIdx = 0;
const STACK_PAGE = 3;

function stackUpdate() {
  const cards = Array.from(document.querySelectorAll('#stack-deck > .stack-card'));
  const n = cards.length;
  const end = Math.min(_stackIdx + STACK_PAGE, n);
  const counter = document.getElementById('stack-counter');
  if (counter) counter.textContent = (_stackIdx + 1) + '–' + end + ' of ' + n;
  cards.forEach(function(card, i) {
    card.style.display = (i >= _stackIdx && i < _stackIdx + STACK_PAGE) ? '' : 'none';
  });
  const prevBtn = document.querySelector('[onclick="stackPrev()"]');
  const nextBtn = document.querySelector('[onclick="stackNext()"]');
  if (prevBtn) prevBtn.disabled = _stackIdx === 0;
  if (nextBtn) nextBtn.disabled = _stackIdx + STACK_PAGE >= n;
}

function stackNext() {
  const n = document.querySelectorAll('#stack-deck > .stack-card').length;
  if (_stackIdx + STACK_PAGE < n) { _stackIdx++; stackUpdate(); }
}

function stackPrev() {
  if (_stackIdx > 0) { _stackIdx--; stackUpdate(); }
}

// ── View toggle ──────────────────────────────────────────────────────────────
function setView(v) {
  ['stack', 'list', 'grid'].forEach(function(name) {
    const el = document.getElementById('view-' + name);
    const btn = document.getElementById('btn-view-' + name);
    if (el) el.style.display = name === v ? '' : 'none';
    if (btn) btn.classList.toggle('active', name === v);
  });
  try { localStorage.setItem('ll-view', v); } catch(e) {}
  if (v === 'stack') stackUpdate();
}

// ── Run-now modal ────────────────────────────────────────────────────────────
let _runNowId = null;
function runNow(id, name) {
  _runNowId = id;
  document.getElementById('run-now-desc').textContent = 'Run "' + name + '" immediately?';
  document.getElementById('run-now-modal').classList.add('open');
  document.getElementById('run-now-confirm').onclick = async () => {
    const input = document.getElementById('run-now-input').value.trim();
    const res = await fetch('/api/workflows/' + id + '/run', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ input })
    });
    if (res.ok) {
      document.getElementById('run-now-modal').classList.remove('open');
      showFlash('Run queued — check Recent activity in a moment.', 'success');
    } else {
      const body = await res.json().catch(() => ({}));
      showFlash(body.error ?? "Couldn't queue this run — try again in a moment.", 'error');
    }
  };
}

async function toggleWorkflow(id, enabled) {
  const res = await fetch('/api/workflows/' + id + '/toggle', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ enabled })
  });
  if (!res.ok) showFlash("Couldn't save that change — try again.", 'error');
}

function showFlash(msg, type) {
  const el = document.createElement('div');
  el.className = 'flash ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function clearRun(id) {
  const res = await fetch('/api/runs/' + id, { method: 'DELETE' });
  if (res.ok) {
    document.getElementById('feed-row-' + id)?.remove();
  } else {
    showFlash("Couldn't clear that run — refresh and try again.", 'error');
  }
}

async function clearAllFailed() {
  const res = await fetch('/api/runs?status=failed', { method: 'DELETE' });
  if (res.ok) {
    document.querySelectorAll('.feed-row.failed').forEach(el => el.closest('.feed-row-wrap')?.remove());
    document.querySelector('.status-banner')?.classList.replace('red', 'green');
    document.querySelector('.status-banner span:last-of-type').textContent = 'All failures cleared';
    document.querySelector('[onclick="clearAllFailed()"]')?.remove();
  } else {
    showFlash("Couldn't clear those runs — refresh and try again.", 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var saved = 'stack';
  try { saved = localStorage.getItem('ll-view') || 'stack'; } catch(e) {}
  setView(saved);
  document.addEventListener('keydown', function(e) {
    const stackEl = document.getElementById('view-stack');
    if (stackEl && stackEl.style.display !== 'none') {
      if (e.key === 'ArrowRight') stackNext();
      if (e.key === 'ArrowLeft') stackPrev();
    }
  });
});
</script>
`;
}
