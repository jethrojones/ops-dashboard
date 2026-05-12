import { layout, esc, relTime, durationStr, statusBadge, runtimeBadge, modal } from './layout.js';
import type { Script, Schedule, Run } from '../types.js';

export interface DriveStateRow {
  folder_id: string;
  last_successful_check_at: string | null;
  last_check_at: string | null;
  last_error: string | null;
  backoff_until: string | null;
}

export interface WorkflowDetailData {
  script: Script & { schedule?: Schedule };
  runs: Run[];
  page: number;
  totalRuns: number;
  userEmail: string;
  driveState?: DriveStateRow[];
}

export function workflowDetailPage(d: WorkflowDetailData): string {
  const { script, runs, page, totalRuns, userEmail, driveState = [] } = d;
  const totalPages = Math.ceil(totalRuns / 20);

  const triggersSection = buildTriggersSection(script, driveState);
  const connectionsSection = buildConnectionsSection(script);
  const scheduleSection = buildScheduleSection(script);
  const runsTable = buildRunsTable(runs, script.id, page, totalPages);

  const triggers = script.metadata?.triggers ?? [];
  const webhookOnly = triggers.length > 0 && triggers.every(t => t.type === 'webhook');

  const content = `
<div class="container">
  <div class="page-header">
    <div>
      <a href="/" class="text-sm" style="color:var(--fg-muted);text-decoration:none;">&larr; All workflows</a>
      <h1 class="page-title" style="margin-top:6px;">${esc(script.name)}</h1>
      <p class="page-subtitle">${esc(script.description)}</p>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px;">
        ${runtimeBadge(script.runtime)}
        ${statusBadge(script.enabled ? 'success' : 'skipped')}
        ${script.version_sha ? `<span class="text-xs text-subtle" title="Current deployed version">SHA: ${esc(script.version_sha.slice(0, 7))}</span>` : ''}
      </div>
    </div>
    <div class="page-actions">
      ${webhookOnly ? '' : `<button class="btn btn-run btn-lg" onclick="runNow()">Run now</button>`}
      <button class="btn btn-ghost btn-lg" id="pause-resume-btn" onclick="toggleWorkflow()">${script.enabled ? 'Pause' : 'Resume'}</button>
      <a class="btn btn-edit btn-lg" href="/workflows/${esc(script.id)}/edit">Edit</a>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:2fr 1fr;gap:var(--s-6);align-items:start;">
    <div>
      ${scheduleSection}
      ${triggersSection}
      ${runsTable}
    </div>
    <div>
      ${connectionsSection}
    </div>
  </div>
</div>

${runNowModal(script)}
${editScheduleModal(script)}

<script>
async function runNow() {
  document.getElementById('run-now-modal').classList.add('open');
}

async function toggleWorkflow() {
  const enabled = ${script.enabled ? 'true' : 'false'};
  const res = await fetch('/api/workflows/${esc(script.id)}/toggle', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ enabled: !enabled })
  });
  if (res.ok) {
    location.reload();
  } else {
    showFlash("Couldn't save that change — try again.", 'error');
  }
}

async function toggleTrigger(triggerIndex, enabled) {
  const res = await fetch('/api/workflows/${esc(script.id)}/toggle-trigger', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ trigger_index: triggerIndex, enabled })
  });
  if (!res.ok) showFlash("Couldn't update the trigger — try again.", 'error');
}

function openEditSchedule() {
  document.getElementById('edit-schedule-modal').classList.add('open');
}

function updateCronPreview(val) {
  const el = document.getElementById('cron-preview');
  if (!el) return;
  const v = val.trim();
  if (!v) { el.textContent = 'Leave blank to disable scheduled runs.'; return; }
  const parts = v.split(/\s+/);
  if (parts.length !== 5) { el.textContent = 'Enter a valid 5-part cron expression (minute hour day month weekday).'; return; }
  const [min, hour, dom, , dow] = parts;
  function fmtTime(h, m) {
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm + ' UTC';
  }
  if (min.startsWith('*/') && hour === '*') {
    el.textContent = 'Runs every ' + parseInt(min.slice(2), 10) + ' minutes.'; return;
  }
  if ((min === '*' || min === '*/1') && hour === '*') {
    el.textContent = 'Runs every minute.'; return;
  }
  if (dom === '*' && dow === '*') {
    el.textContent = 'Runs every day at ' + fmtTime(parseInt(hour, 10), parseInt(min, 10) || 0) + '.'; return;
  }
  if (dom === '*' && dow === '1-5') {
    el.textContent = 'Runs weekdays (Mon–Fri) at ' + fmtTime(parseInt(hour, 10), parseInt(min, 10) || 0) + '.'; return;
  }
  if (dom === '*' && dow === '1') { el.textContent = 'Runs every Monday at ' + fmtTime(parseInt(hour, 10), parseInt(min, 10) || 0) + '.'; return; }
  el.textContent = 'Custom schedule: ' + v;
}

async function saveSchedule() {
  const cron = document.getElementById('schedule-cron-input').value.trim();
  const bizHours = document.getElementById('biz-hours-checkbox').checked;
  const res = await fetch('/api/workflows/${esc(script.id)}/schedule', {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ cron_expression: cron, business_hours_only: bizHours })
  });
  if (res.ok) {
    document.getElementById('edit-schedule-modal').classList.remove('open');
    location.reload();
  } else {
    showFlash("Couldn't save the schedule — check the cron expression and try again.", 'error');
  }
}

function showFlash(msg, type) {
  const el = document.createElement('div');
  el.className = 'flash ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
</script>
`;

  return layout(content, { title: script.name, activeNav: 'dashboard', userEmail });
}

function buildScheduleSection(script: Script & { schedule?: Schedule }): string {
  const triggers = script.metadata?.triggers ?? [];
  const webhookOnly = triggers.length > 0 && triggers.every(t => t.type === 'webhook');

  // Webhook-only scripts are not scheduled — their triggers section explains how they run.
  if (webhookOnly) return '';

  const sched = script.schedule;
  let schedText = 'No schedule configured — runs manually or via webhook only.';
  let nextRunText = '';

  if (sched?.cron_expression) {
    schedText = cronToEnglish(sched.cron_expression);
    if (sched.business_hours_only) {
      schedText += ' (business hours only, Mon–Fri)';
    }
    if (sched.next_run_at) {
      nextRunText = `<span class="text-xs text-subtle">Next run: ${relTime(sched.next_run_at)}</span>`;
    }
  }

  const currentCron = sched?.cron_expression ?? '';

  return `
<div class="section">
  <div class="section-title">Schedule</div>
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--s-4);flex-wrap:wrap;">
      <div>
        <p style="font-weight:600;font-size:var(--t-sm);">${esc(schedText)}</p>
        ${nextRunText}
        ${currentCron ? `<code style="font-family:var(--font-mono);font-size:12px;color:var(--fg-subtle);background:var(--bg-sunken);padding:2px 8px;border-radius:var(--r-xs);margin-top:4px;display:inline-block;">${esc(currentCron)}</code>` : ''}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="openEditSchedule()">Edit schedule</button>
    </div>
  </div>
</div>`;
}

function buildTriggersSection(script: Script & { schedule?: Schedule }, driveState: DriveStateRow[]): string {
  const triggers = script.metadata?.triggers ?? [];
  if (triggers.length === 0) return '';

  const rows = triggers.map((t, i) => {
    let label = '';
    let detail = '';

    if (t.type === 'cron') {
      label = 'Scheduled (cron)';
    } else if (t.type === 'webhook') {
      label = `Webhook — ${esc(t.service ?? '')} <code style="font-size:11px;background:var(--bg-sunken);padding:1px 6px;border-radius:3px;">${esc(t.event ?? '')}</code>`;
    } else if (t.type === 'drive') {
      label = `Google Drive — folder <code style="font-size:11px;background:var(--bg-sunken);padding:1px 6px;border-radius:3px;">${esc(t.folder_id ?? '')}</code>`;
      const ds = driveState.find(s => s.folder_id === t.folder_id);
      if (ds) {
        const lastCheck = ds.last_successful_check_at ? `last successful check ${relTime(ds.last_successful_check_at)}` : 'never checked';
        const nextCheck = ds.backoff_until ? `next check ${relTime(ds.backoff_until)}` : 'next check in ~5 minutes';
        detail = `<span class="text-xs text-subtle" style="display:block;margin-top:4px;">Checking every 5 minutes — ${esc(lastCheck)}, ${esc(nextCheck)}.</span>`;
        if (ds.last_error) {
          detail += `<span class="text-xs" style="color:var(--danger);display:block;margin-top:2px;">Last error: ${esc(ds.last_error)}</span>`;
        }
      }
    } else if (t.type === 'manual') {
      label = 'Manual (on-demand)';
    }

    return `
<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s-4);padding:var(--s-4) 0;border-bottom:1px solid var(--border);">
  <div style="flex:1;min-width:0;">
    <span class="text-sm" style="font-weight:600;">${label}</span>
    ${detail}
  </div>
  <label class="toggle" title="${t.enabled ? 'Disable trigger' : 'Enable trigger'}">
    <input type="checkbox" ${t.enabled ? 'checked' : ''} onchange="toggleTrigger(${i}, this.checked)">
    <span class="toggle-track"></span>
  </label>
</div>`;
  }).join('');

  return `
<div class="section">
  <div class="section-title">Triggers</div>
  <div class="card" style="padding:0 var(--s-6);">
    ${rows}
    <div style="height:1px;"></div>
  </div>
</div>`;
}

function buildConnectionsSection(script: Script): string {
  const required = script.metadata?.required_secrets ?? [];
  if (required.length === 0) return '';

  // We can only show a static indicator here — live status check is done on the settings page
  const items = required.map(svc => `
<div style="display:flex;align-items:center;gap:var(--s-3);padding:var(--s-3) 0;border-bottom:1px solid var(--border);">
  <span class="conn-status ok" id="conn-${esc(svc)}">Checking…</span>
  <span class="text-sm" style="font-weight:600;">${esc(svcLabel(svc))}</span>
</div>`).join('');

  return `
<div class="section">
  <div class="section-title">Required connections</div>
  <div class="card" style="padding:0 var(--s-6);">
    ${items}
    <div style="height:1px;"></div>
  </div>
</div>
<script>
(async () => {
  const services = ${JSON.stringify(required)};
  for (const svc of services) {
    try {
      const res = await fetch('/api/secrets/' + svc + '/status');
      const data = await res.json();
      const el = document.getElementById('conn-' + svc);
      if (el) {
        el.className = 'conn-status ' + (data.ok ? 'ok' : 'bad');
        el.textContent = data.ok ? 'Connected' : 'Not connected';
        el.title = data.message ?? '';
      }
    } catch {}
  }
})();
</script>`;
}

function buildRunsTable(runs: Run[], scriptId: string, page: number, totalPages: number): string {
  const statusOptions = ['', 'success', 'failed', 'running', 'skipped'];
  const filterSelect = `<select class="form-input" style="width:auto;padding:6px 12px;font-size:var(--t-xs);" onchange="location.search='?status='+this.value+'&page=1'">
    ${statusOptions.map(s => `<option value="${esc(s)}">${s === '' ? 'All statuses' : esc(s)}</option>`).join('')}
  </select>`;

  const hasFailed = runs.some(r => r.status === 'failed' || r.status === 'skipped');

  const rows = runs.map(r => {
    const clearable = r.status === 'failed' || r.status === 'skipped';
    return `
<tr id="run-row-${esc(r.id)}" class="${r.status === 'failed' ? 'failed' : ''}">
  <td onclick="location.href='/workflows/${esc(scriptId)}/runs/${esc(r.id)}'" style="cursor:pointer;">${statusBadge(r.status)}</td>
  <td onclick="location.href='/workflows/${esc(scriptId)}/runs/${esc(r.id)}'" class="text-sm" style="cursor:pointer;">${relTime(r.started_at)}</td>
  <td onclick="location.href='/workflows/${esc(scriptId)}/runs/${esc(r.id)}'" class="text-sm text-subtle" style="cursor:pointer;">${durationStr(r.duration_ms)}</td>
  <td onclick="location.href='/workflows/${esc(scriptId)}/runs/${esc(r.id)}'" class="text-sm text-subtle" style="cursor:pointer;">${esc(r.trigger_type)}</td>
  <td onclick="location.href='/workflows/${esc(scriptId)}/runs/${esc(r.id)}'" class="text-sm text-subtle" style="cursor:pointer;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.error_summary ? esc(r.error_summary) : '—'}</td>
  <td>${clearable ? `<button class="btn btn-ghost btn-sm" onclick="clearRun('${esc(r.id)}')" style="white-space:nowrap;">Clear</button>` : ''}</td>
</tr>`;
  }).join('');

  const prevLink = page > 1 ? `<a href="?page=${page - 1}" class="btn btn-ghost btn-sm">&larr; Prev</a>` : '';
  const nextLink = page < totalPages ? `<a href="?page=${page + 1}" class="btn btn-ghost btn-sm">Next &rarr;</a>` : '';

  return `
<div class="section">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--s-4);">
    <span class="section-title" style="margin-bottom:0;">Run history</span>
    <div style="display:flex;align-items:center;gap:var(--s-3);">
      ${hasFailed ? `<button class="btn btn-ghost btn-sm" id="clear-all-btn" onclick="clearAllFailed()">Clear all failed</button>` : ''}
      ${filterSelect}
      <span class="text-xs text-subtle">${totalRuns(runs)} total</span>
    </div>
  </div>
  <div class="card" style="padding:0;">
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Status</th>
          <th>Started</th>
          <th>Duration</th>
          <th>Trigger</th>
          <th>Error</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${rows || '<tr><td colspan="6" class="text-muted text-sm" style="text-align:center;padding:24px;">No runs found.</td></tr>'}
        </tbody>
      </table>
    </div>
    ${(prevLink || nextLink) ? `<div style="display:flex;justify-content:space-between;padding:var(--s-4) var(--s-6);border-top:1px solid var(--border);">${prevLink}<span></span>${nextLink}</div>` : ''}
  </div>
</div>

<script>
async function clearRun(id) {
  const res = await fetch('/api/runs/' + id, { method: 'DELETE' });
  if (res.ok) {
    document.getElementById('run-row-' + id)?.remove();
  } else {
    showFlash("Couldn't clear that run — refresh and try again.", 'error');
  }
}

async function clearAllFailed() {
  const res = await fetch('/api/runs?status=failed', { method: 'DELETE' });
  if (res.ok) {
    document.querySelectorAll('tr.failed').forEach(el => el.remove());
    document.getElementById('clear-all-btn')?.remove();
  } else {
    showFlash("Couldn't clear those runs — refresh and try again.", 'error');
  }
}
</script>`;
}

function totalRuns(runs: Run[]): number {
  return runs.length;
}

function runNowModal(script: Script): string {
  const schema = script.metadata?.params_schema;

  let inputHtml: string;
  let buildPayloadJs: string;

  if (schema && schema.length > 0) {
    const fields = schema.map(p => {
      if (p.type === 'boolean') {
        const checked = p.default === true ? 'checked' : '';
        return `
<div style="margin-top:var(--s-4);">
  <label style="display:flex;align-items:flex-start;gap:var(--s-3);cursor:pointer;padding:var(--s-4);background:var(--bg-sunken);border-radius:var(--r-md);border:1.5px solid var(--border);">
    <input type="checkbox" id="param-${esc(p.key)}" ${checked} style="margin-top:2px;width:16px;height:16px;flex-shrink:0;accent-color:var(--teal);">
    <div>
      <span style="font-size:var(--t-sm);font-weight:700;">${esc(p.label)}</span>
      <p class="form-hint" style="margin-top:2px;margin-bottom:0;">${esc(p.description)}</p>
    </div>
  </label>
</div>`;
      } else if (p.type === 'number') {
        return `
<div class="form-group" style="margin-top:var(--s-4);">
  <label class="form-label" for="param-${esc(p.key)}">${esc(p.label)}</label>
  <input type="number" class="form-input" id="param-${esc(p.key)}" value="${esc(String(p.default ?? ''))}" style="width:100px;">
  <p class="form-hint">${esc(p.description)}</p>
</div>`;
      } else if (p.type === 'textarea') {
        return `
<div class="form-group" style="margin-top:var(--s-4);">
  <label class="form-label" for="param-${esc(p.key)}">${esc(p.label)}</label>
  <textarea class="form-input" id="param-${esc(p.key)}" rows="4" placeholder="One URL per line" style="resize:vertical;">${esc(String(p.default ?? ''))}</textarea>
  <p class="form-hint">${esc(p.description)}</p>
</div>`;
      } else {
        return `
<div class="form-group" style="margin-top:var(--s-4);">
  <label class="form-label" for="param-${esc(p.key)}">${esc(p.label)}</label>
  <input type="text" class="form-input" id="param-${esc(p.key)}" value="${esc(String(p.default ?? ''))}">
  <p class="form-hint">${esc(p.description)}</p>
</div>`;
      }
    }).join('');

    inputHtml = `
<p class="text-sm text-muted">This will run the workflow immediately, regardless of schedule.</p>
${fields}`;

    buildPayloadJs = `
function buildRunPayload() {
  const schema = ${JSON.stringify(schema)};
  const payload = {};
  for (const p of schema) {
    const el = document.getElementById('param-' + p.key);
    if (!el) continue;
    if (p.type === 'boolean') {
      payload[p.key] = el.checked;
    } else if (p.type === 'number') {
      const v = parseFloat(el.value);
      if (!isNaN(v)) payload[p.key] = v;
    } else if (p.type === 'textarea') {
      const lines = el.value.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length > 0) payload[p.key] = lines;
    } else {
      if (el.value.trim()) payload[p.key] = el.value.trim();
    }
  }
  return payload;
}`;
  } else {
    inputHtml = `
<p class="text-sm text-muted">This will run the workflow immediately, regardless of schedule.</p>
<div class="form-group" style="margin-top:var(--s-5);">
  <label class="form-label" for="run-now-input">Input payload (optional JSON)</label>
  <textarea class="form-input" id="run-now-input" placeholder='{"key": "value"}'></textarea>
  <p class="form-hint">Leave blank for a default run with no extra parameters.</p>
</div>`;

    buildPayloadJs = `
function buildRunPayload() {
  const raw = document.getElementById('run-now-input')?.value.trim();
  if (!raw) return undefined;
  try { return JSON.parse(raw); }
  catch { showFlash("That payload isn't valid JSON — check for missing quotes or commas. Leave it blank to use default params.", 'error'); return null; }
}`;
  }

  return modal('run-now-modal', `Run "${esc(script.name)}"`, `
${inputHtml}
<div style="display:flex;gap:var(--s-3);margin-top:var(--s-5);">
  <button class="btn btn-run btn-full" onclick="confirmRunNow()">Run now</button>
  <button class="btn btn-ghost" data-close-modal>Cancel</button>
</div>
`) + `
<script>
${buildPayloadJs}

async function confirmRunNow() {
  const input = buildRunPayload();
  if (input === null) return;
  const res = await fetch('/api/workflows/${esc(script.id)}/run', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ input })
  });
  if (res.ok) {
    document.getElementById('run-now-modal').classList.remove('open');
    showFlash('Run queued successfully.', 'success');
    setTimeout(() => location.reload(), 1500);
  } else {
    const body = await res.json().catch(() => ({}));
    showFlash(body.error ?? "Couldn't queue this run — try again in a moment.", 'error');
  }
}
</script>`;
}

function editScheduleModal(script: Script & { schedule?: Schedule }): string {
  const sched = script.schedule;
  const currentCron = sched?.cron_expression ?? '';
  const initialPreview = currentCron ? cronToEnglish(currentCron) : 'Leave blank to disable scheduled runs.';
  return modal('edit-schedule-modal', 'Edit schedule', `
    <div class="form-group">
      <label class="form-label" for="schedule-cron-input">When should this run?</label>
      <input class="form-input" id="schedule-cron-input" placeholder="e.g. weekdays at 2pm UTC → 0 14 * * 1-5" value="${esc(currentCron)}" oninput="updateCronPreview(this.value)">
      <p class="form-hint" id="cron-preview" style="font-style:italic;">${esc(initialPreview)}</p>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="checkbox" id="biz-hours-checkbox" ${sched?.business_hours_only ? 'checked' : ''} style="width:16px;height:16px;">
        <span class="form-label" style="margin:0;">Skip runs outside business hours (Mon–Fri, 10am–11pm UTC)</span>
      </label>
    </div>
    <div style="display:flex;gap:var(--s-3);margin-top:var(--s-5);">
      <button class="btn btn-primary btn-full" onclick="saveSchedule()">Save schedule</button>
      <button class="btn btn-ghost" data-close-modal>Cancel</button>
    </div>
  `);
}

function cronToEnglish(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron; // non-standard — show as-is
  const [min, hour, dom, , dow] = parts;

  const DOW_NAMES: Record<string, string> = {
    '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
    '4': 'Thursday', '5': 'Friday', '6': 'Saturday',
  };

  function fmtTime(h: string | number, m: string | number): string {
    const hNum = typeof h === 'string' ? parseInt(h, 10) : h;
    const mNum = typeof m === 'string' ? (parseInt(m, 10) || 0) : m;
    const ampm = hNum >= 12 ? 'PM' : 'AM';
    const h12 = hNum % 12 || 12;
    return `${h12}:${String(mNum).padStart(2, '0')} ${ampm}`;
  }

  // Every minute
  if ((min === '*/1' || min === '*') && hour === '*') return 'Every minute';

  // Every N minutes
  if (min.startsWith('*/') && hour === '*') {
    const n = parseInt(min.slice(2), 10);
    return `Every ${n} minute${n === 1 ? '' : 's'}`;
  }

  // Hourly range with step: e.g. 9-17/2 → "Every 2 hours, 9:00 AM–5:00 PM"
  const hourStepMatch = hour.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (hourStepMatch && dom === '*') {
    const [, startH, endH, step] = hourStepMatch;
    const dowLabel = dow === '1-5' ? ', Mon–Fri' : dow === '*' ? '' : `, ${DOW_NAMES[dow] ?? dow}s`;
    return `Every ${step} hours, ${fmtTime(startH, min)}–${fmtTime(endH, 0)}${dowLabel}`;
  }

  if (dom === '*') {
    // Fixed time — determine day label
    let dayLabel = '';
    if (dow === '*')   dayLabel = 'Daily';
    else if (dow === '1-5') dayLabel = 'Weekdays (Mon–Fri)';
    else if (DOW_NAMES[dow]) dayLabel = `Every ${DOW_NAMES[dow]}`;
    else dayLabel = `Every ${dow}`;

    return `${dayLabel} at ${fmtTime(hour, min)}`;
  }

  return cron; // fallback — show raw expression
}

function svcLabel(service: string): string {
  const labels: Record<string, string> = {
    hubspot: 'HubSpot',
    kit: 'Kit (ConvertKit)',
    instantly: 'Instantly',
    docuseal: 'DocuSeal',
    drive: 'Google Drive',
    resend: 'Resend',
    brave_search: 'Brave Search',
    github_pat: 'GitHub PAT',
  };
  return labels[service] ?? service;
}
