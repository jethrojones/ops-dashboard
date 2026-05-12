import { layout, esc, relTime, durationStr, statusBadge } from './layout.js';
import type { Run } from '../types.js';

export interface RunsListData {
  runs: (Run & { script_name: string })[];
  total: number;
  page: number;
  perPage: number;
  filters: {
    q: string;
    status: string;
    since: string;  // YYYY-MM-DD or ''
    until: string;  // YYYY-MM-DD or ''
  };
  userEmail: string;
}

export function runsListPage(d: RunsListData): string {
  const { runs, total, page, perPage, filters, userEmail } = d;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const statusOptions = ['', 'success', 'failed', 'running', 'skipped'];

  const rows = runs.map(r => `
<tr onclick="location.href='/workflows/${esc(r.script_id)}/runs/${esc(r.id)}'" style="cursor:pointer;" class="${r.status === 'failed' ? 'failed' : ''}">
  <td>${statusBadge(r.status)}</td>
  <td class="text-sm" style="font-weight:600;">${esc(r.script_name)}</td>
  <td class="text-sm">${relTime(r.started_at)}</td>
  <td class="text-sm text-subtle">${durationStr(r.duration_ms)}</td>
  <td class="text-sm text-subtle">${esc(r.trigger_type)}</td>
  <td class="text-sm text-subtle" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.error_summary ? esc(r.error_summary) : '—'}</td>
</tr>`).join('');

  const buildHref = (overrides: Partial<{ page: number; q: string; status: string; since: string; until: string }>): string => {
    const params = new URLSearchParams();
    const merged = { page, q: filters.q, status: filters.status, since: filters.since, until: filters.until, ...overrides };
    if (merged.page && merged.page > 1) params.set('page', String(merged.page));
    if (merged.q) params.set('q', merged.q);
    if (merged.status) params.set('status', merged.status);
    if (merged.since) params.set('since', merged.since);
    if (merged.until) params.set('until', merged.until);
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  };

  const prevLink = page > 1
    ? `<a href="${esc(buildHref({ page: page - 1 }))}" class="btn btn-ghost btn-sm">&larr; Prev</a>`
    : '<span class="btn btn-ghost btn-sm" style="opacity:.4;pointer-events:none;">&larr; Prev</span>';
  const nextLink = page < totalPages
    ? `<a href="${esc(buildHref({ page: page + 1 }))}" class="btn btn-ghost btn-sm">Next &rarr;</a>`
    : '<span class="btn btn-ghost btn-sm" style="opacity:.4;pointer-events:none;">Next &rarr;</span>';

  const filterCount =
    (filters.q ? 1 : 0) + (filters.status ? 1 : 0) + (filters.since ? 1 : 0) + (filters.until ? 1 : 0);
  const hasFilters = filterCount > 0;

  const content = `
<div class="container">
  <div class="page-header">
    <div>
      <h1 class="page-title">Runs</h1>
      <p class="page-subtitle">Search and filter run history across every workflow.</p>
    </div>
  </div>

  <form method="get" class="card" style="padding:var(--s-5);margin-bottom:var(--s-5);">
    <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr auto;gap:var(--s-3);align-items:end;">
      <div>
        <label class="text-xs" style="display:block;margin-bottom:4px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--fg-muted);">Workflow name contains</label>
        <input type="text" name="q" value="${esc(filters.q)}" placeholder="e.g. hubspot" class="form-input" style="width:100%;">
      </div>
      <div>
        <label class="text-xs" style="display:block;margin-bottom:4px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--fg-muted);">Status</label>
        <select name="status" class="form-input" style="width:100%;">
          ${statusOptions.map(s => `<option value="${esc(s)}"${s === filters.status ? ' selected' : ''}>${s === '' ? 'Any' : esc(s)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="text-xs" style="display:block;margin-bottom:4px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--fg-muted);">From</label>
        <input type="date" name="since" value="${esc(filters.since)}" class="form-input" style="width:100%;">
      </div>
      <div>
        <label class="text-xs" style="display:block;margin-bottom:4px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--fg-muted);">To</label>
        <input type="date" name="until" value="${esc(filters.until)}" class="form-input" style="width:100%;">
      </div>
      <div style="display:flex;gap:var(--s-2);">
        <button type="submit" class="btn btn-primary btn-sm">Filter</button>
        ${hasFilters ? `<a href="/runs" class="btn btn-ghost btn-sm">Clear</a>` : ''}
      </div>
    </div>
  </form>

  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--s-3);">
    <span class="text-sm text-subtle">
      ${total === 0 ? 'No runs match' : `${total.toLocaleString()} run${total === 1 ? '' : 's'}${hasFilters ? ' match' : ''} — page ${page} of ${totalPages}`}
    </span>
    <div style="display:flex;gap:var(--s-2);">
      ${prevLink}
      ${nextLink}
    </div>
  </div>

  <div class="card" style="padding:0;">
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Status</th>
          <th>Workflow</th>
          <th>Started</th>
          <th>Duration</th>
          <th>Trigger</th>
          <th>Error</th>
        </tr></thead>
        <tbody>
          ${rows || '<tr><td colspan="6" class="text-muted text-sm" style="text-align:center;padding:32px;">No runs found.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <div style="display:flex;justify-content:flex-end;gap:var(--s-2);margin-top:var(--s-4);">
    ${prevLink}
    ${nextLink}
  </div>
</div>`;

  return layout(content, { title: 'Runs', activeNav: 'runs', userEmail });
}
