import { CSS } from './styles.js';

export interface LayoutOptions {
  title: string;
  activeNav?: 'dashboard' | 'runs' | 'add-new' | 'settings';
  userEmail?: string;
  head?: string;
}

export function layout(content: string, opts: LayoutOptions): string {
  const { title, activeNav, userEmail, head = '' } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Ops Dashboard</title>
<style>${CSS}</style>
${head}
</head>
<body>
<nav class="nav">
  <a class="nav-brand" href="/"><span class="dot"></span>Ops Dashboard</a>
  <div class="nav-links">
    <a href="/" class="${activeNav === 'dashboard' ? 'active' : ''}">Dashboard</a>
    <a href="/runs" class="${activeNav === 'runs' ? 'active' : ''}">Runs</a>
    <a href="/add-new" class="${activeNav === 'add-new' ? 'active' : ''}">Add new</a>
    <a href="/settings/connections" class="${activeNav === 'settings' ? 'active' : ''}">Settings</a>
  </div>
  <button class="nav-help" type="button" onclick="openTour()" title="Tour the console" aria-label="Help">?</button>
  ${userEmail ? `<span class="nav-user">${esc(userEmail)}</span>` : ''}
</nav>
<main>
${content}
</main>
${tourModal()}
<script>
// Info modal toggle
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-modal]');
  if (btn) {
    const id = btn.dataset.modal;
    document.getElementById(id)?.classList.add('open');
  }
  const overlay = e.target.closest('.modal-overlay');
  if (overlay && e.target === overlay) overlay.classList.remove('open');
  const close = e.target.closest('[data-close-modal]');
  if (close) close.closest('.modal-overlay')?.classList.remove('open');
});

// Auto-dismiss flash messages
setTimeout(() => {
  document.querySelectorAll('.flash').forEach(el => el.remove());
}, 4000);

// Copy to clipboard helper
window.copyText = async (text, btn) => {
  await navigator.clipboard.writeText(text);
  const orig = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = orig, 2000);
};

// First-run tour
const TOUR_STEPS = ${JSON.stringify(TOUR_STEPS)};
let _tourIdx = 0;

window.openTour = function() {
  _tourIdx = 0;
  renderTour();
  document.getElementById('tour-modal').classList.add('open');
};
window.closeTour = function() {
  document.getElementById('tour-modal').classList.remove('open');
  try { localStorage.setItem('ll_ops_tour_seen', '1'); } catch (e) {}
};
window.tourPrev = function() { if (_tourIdx > 0) { _tourIdx--; renderTour(); } };
window.tourNext = function() {
  if (_tourIdx < TOUR_STEPS.length - 1) { _tourIdx++; renderTour(); }
  else { window.closeTour(); }
};

function renderTour() {
  const step = TOUR_STEPS[_tourIdx];
  document.getElementById('tour-eyebrow').textContent = 'Step ' + (_tourIdx + 1) + ' of ' + TOUR_STEPS.length;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-body').innerHTML = step.body;
  document.getElementById('tour-prev').style.visibility = _tourIdx === 0 ? 'hidden' : 'visible';
  document.getElementById('tour-next').textContent = _tourIdx === TOUR_STEPS.length - 1 ? "I'm ready" : 'Next →';
  // Render dot indicators
  const dots = TOUR_STEPS.map((_, i) =>
    '<span class="tour-dot' + (i === _tourIdx ? ' active' : '') + '"></span>'
  ).join('');
  document.getElementById('tour-dots').innerHTML = dots;
}

// Auto-open on first visit (only on dashboard so the tour starts where users land)
(function() {
  try {
    if (location.pathname === '/' && !localStorage.getItem('ll_ops_tour_seen')) {
      setTimeout(() => window.openTour(), 400);
    }
  } catch (e) {}
})();
</script>
</body>
</html>`;
}

export function flash(message: string, type: 'success' | 'error' = 'success'): string {
  const color = type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)';
  const border = type === 'success' ? 'var(--success-border)' : 'var(--error-border)';
  const text = type === 'success' ? 'var(--success)' : 'var(--error)';
  return `<div class="flash" style="position:fixed;bottom:24px;right:24px;background:${color};border:1px solid ${border};color:${text};padding:12px 20px;border-radius:var(--radius);font-weight:600;font-size:14px;box-shadow:var(--shadow-md);z-index:300;">${esc(message)}</div>`;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const abs = -diff;
    if (abs < 3600_000) return `in ${Math.ceil(abs / 60_000)}m`;
    if (abs < 86400_000) return `in ${Math.floor(abs / 3600_000)}h`;
    return `in ${Math.floor(abs / 86400_000)}d`;
  }
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export function durationStr(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function statusBadge(status: string): string {
  return `<span class="badge ${status}">${esc(status)}</span>`;
}

export function runtimeBadge(runtime: string): string {
  return `<span class="runtime-badge ${runtime}">${esc(runtime)}</span>`;
}

export function modal(id: string, title: string, content: string): string {
  return `<div class="modal-overlay" id="${esc(id)}">
  <div class="modal" style="position:relative;">
    <button class="modal-close" data-close-modal aria-label="Close">&times;</button>
    <h2 class="modal-title">${esc(title)}</h2>
    ${content}
  </div>
</div>`;
}

// ─── First-run tour ──────────────────────────────────────────────────────────
// Auto-opens the first time someone lands on the dashboard. Reopen anytime
// from the "?" button in the top nav. Content is plain HTML — kept short.

const TOUR_STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Welcome to the Ops Dashboard',
    body: `
      <p>This is where every automation in your worker lives — daily reports, syncs between APIs, scheduled jobs, webhook handlers.</p>
      <p>Each automation is called a <strong>workflow</strong>. They run on schedules or you can trigger them manually.</p>
      <p>This tour shows what each page does. Reopen it anytime via the <strong>?</strong> in the top nav.</p>
    `,
  },
  {
    title: 'Dashboard — workflow control center',
    body: `
      <p>Every workflow appears as a card. The colored top edge shows the most recent status:</p>
      <ul>
        <li><strong>Green</strong> — last run succeeded</li>
        <li><strong>Red</strong> — last run failed</li>
        <li><strong>Yellow</strong> — last run was skipped</li>
        <li><strong>Blue</strong> — currently running</li>
      </ul>
      <p>Each card has three buttons: <strong>Run now</strong> (trigger immediately), <strong>Details</strong> (history + run logs), <strong>Edit</strong> (schedule + connection settings).</p>
      <p>Switch between <strong>stack</strong>, <strong>list</strong>, and <strong>grid</strong> views with the toggle in the top-right.</p>
    `,
  },
  {
    title: 'Runs — search every run, ever',
    body: `
      <p>The <strong>Runs</strong> tab shows the history of every workflow run. Click any row for the full log.</p>
      <p>Filter by name, status (success / failed / running / skipped), or date range.</p>
    `,
  },
  {
    title: 'Settings — keys, connections, and notifications',
    body: `
      <p>Under <strong>Settings</strong>:</p>
      <ul>
        <li><strong>Connections</strong> — API keys for each connected service. If a workflow fails with an "auth" error, this is where you rotate the key.</li>
        <li><strong>Notifications</strong> — who gets emailed when a workflow fails.</li>
        <li><strong>Account</strong> — usage against the Cloudflare free-tier limits.</li>
      </ul>
    `,
  },
  {
    title: 'If something fails',
    body: `
      <p>You'll get an email with the error category (auth, rate limit, network, schema, or unexpected). Open <strong>Run Detail</strong> from the email or the dashboard.</p>
      <p>The <strong>Copy for Claude</strong> button on the run detail page bundles the source, full log, and error into one payload you can paste into an LLM to diagnose.</p>
      <p>That's the tour. Adding new automations? See the <strong>Add new</strong> tab.</p>
    `,
  },
];

function tourModal(): string {
  return `<div class="modal-overlay tour-overlay" id="tour-modal">
  <div class="tour-card" role="dialog" aria-labelledby="tour-title">
    <div class="tour-header">
      <span class="tour-eyebrow" id="tour-eyebrow">Step 1 of ${TOUR_STEPS.length}</span>
      <button type="button" class="tour-x" onclick="closeTour()" aria-label="Close tour">&times;</button>
    </div>
    <h2 class="tour-title" id="tour-title"></h2>
    <div class="tour-body" id="tour-body"></div>
    <div class="tour-footer">
      <div class="tour-dots" id="tour-dots"></div>
      <div class="tour-nav">
        <button type="button" class="tour-btn tour-btn-ghost" id="tour-prev" onclick="tourPrev()">← Back</button>
        <button type="button" class="tour-btn tour-btn-primary" id="tour-next" onclick="tourNext()">Next →</button>
      </div>
    </div>
  </div>
</div>`;
}
