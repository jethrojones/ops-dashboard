// Design tokens for the Ops Dashboard UI.
//
// Defaults to the "Glassline" palette: fog-grey neutrals with a single cobalt
// accent. See docs/design.md for the source spec, do's-and-don'ts, and tips
// on swapping in a different palette.
//
// To customize: edit the `:root` block below. Six color tokens
// (--color-primary/secondary/tertiary/neutral/surface/on-primary), one font
// family, and a handful of radius/spacing values. Everything else is derived.
//
// The `--ll-*` block at the bottom is a back-compat alias layer so the per-page
// HTML doesn't have to change when you swap palettes — `--ll-purple` etc are
// just pointers into the semantic tokens above them. Touching them is
// optional; they exist so a future palette swap doesn't break the chrome.

export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap');

:root {
  /* ─── Design tokens (Glassline) ──────────────────────────────────────── */
  /* Edit these six values to re-skin the entire app. */
  --color-primary:     #0F1419;
  --color-secondary:   #4A5568;
  --color-tertiary:    #2C5EF5;
  --color-neutral:     #F1F3F5;
  --color-surface:     #FFFFFF;
  --color-on-primary:  #FFFFFF;

  /* Glassline status colors — neutral-leaning so they don't compete with the cobalt accent */
  --color-success:     #15803D;
  --color-success-bg:  #ECFDF5;
  --color-warning:     #B45309;
  --color-warning-bg:  #FFFBEB;
  --color-danger:      #B91C1C;
  --color-danger-bg:   #FEF2F2;
  --color-running:     var(--color-tertiary);
  --color-running-bg:  #EEF2FF;

  /* Type */
  --font-sans:    'Geist', system-ui, -apple-system, sans-serif;
  --font-display: 'Geist', system-ui, -apple-system, sans-serif;
  --font-mono:    'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --t-xs:12px; --t-sm:13.5px; --t-base:15px; --t-md:17px; --t-lg:19px;
  --t-xl:22px; --t-2xl:28px; --t-3xl:36px;
  --w-regular:400; --w-medium:500; --w-semi:600; --w-bold:700; --w-extra:800;
  --lh-tight:1.1; --lh-snug:1.25; --lh-normal:1.55;
  --track-tight:-0.02em; --track-wide:0.04em; --track-caps:0.08em;

  /* Radii (Glassline) */
  --r-xs:   4px;
  --r-sm:   6px;
  --r-md:  10px;
  --r-lg:  16px;
  --r-xl:  22px;
  --r-pill: 999px;

  /* Spacing (4pt scale, biased to Glassline 8/16/32) */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px;
  --s-6:24px; --s-8:32px; --s-10:40px; --s-12:48px; --s-16:64px;

  /* Elevation — soft, grey-tinted to fit the calm palette */
  --shadow-xs: 0 1px 2px rgba(15,20,25,.06);
  --shadow-sm: 0 2px 6px rgba(15,20,25,.06), 0 1px 2px rgba(15,20,25,.04);
  --shadow-md: 0 6px 16px rgba(15,20,25,.08), 0 2px 4px rgba(15,20,25,.04);
  --shadow-lg: 0 16px 40px rgba(15,20,25,.12), 0 4px 10px rgba(15,20,25,.05);
  --shadow-xl: 0 24px 56px rgba(15,20,25,.16), 0 6px 14px rgba(15,20,25,.06);
  --shadow-brand: 0 4px 12px rgba(44,94,245,.18);

  /* Focus ring */
  --focus-ring: 0 0 0 3px rgba(44,94,245,.4);

  /* Motion */
  --ease-out:    cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --dur-fast:140ms; --dur-base:220ms; --dur-slow:360ms;

  /* Borders */
  --border:        #E5E7EB;
  --border-strong: #D1D5DB;

  /* ─── Semantic aliases (used throughout) ─────────────────────────────── */
  --bg:           var(--color-neutral);
  --bg-elevated:  var(--color-surface);
  --bg-sunken:    #E5E7EB;
  --fg:           var(--color-primary);
  --fg-muted:     var(--color-secondary);
  --fg-subtle:    #6B7280;
  --fg-inverse:   var(--color-on-primary);
  --fg-brand:     var(--color-tertiary);
  --fg-accent:    var(--color-tertiary);
  --primary:      var(--color-tertiary);
  --primary-hover:#1E4BD6;
  --primary-fg:   var(--color-on-primary);
  --accent:       var(--color-tertiary);
  --accent-hover: #1E4BD6;
  --accent-fg:    var(--color-on-primary);

  --success:      var(--color-success);
  --success-soft: var(--color-success-bg);
  --warning:      var(--color-warning);
  --warning-soft: var(--color-warning-bg);
  --danger:       var(--color-danger);
  --danger-soft:  var(--color-danger-bg);
  --running:      var(--color-running);
  --running-soft: var(--color-running-bg);

  /* ─── Compatibility aliases (do not delete) ──────────────────────────── */
  /* HTML pages were authored against named tokens. These keep the chrome
     working when the design.md palette is swapped — only the semantic tokens
     above need to change. */
  --ll-teal:        var(--color-tertiary);
  --ll-teal-deep:   var(--color-tertiary);
  --ll-teal-soft:   #DEE6FE;
  --ll-teal-wash:   #EEF2FF;
  --ll-purple:      var(--color-primary);
  --ll-purple-deep: #000000;
  --ll-purple-soft: #E5E7EB;
  --ll-purple-wash: #F1F3F5;
  --ll-black:       var(--color-primary);
  --ll-ink:         var(--color-secondary);
  --ll-off-white:   var(--color-neutral);
  --ll-white:       var(--color-surface);
  --ll-n-50:  #FAFBFC;
  --ll-n-100: #F1F3F5;
  --ll-n-200: #E5E7EB;
  --ll-n-300: #D1D5DB;
  --ll-n-400: #9CA3AF;
  --ll-n-500: #6B7280;
  --ll-n-600: #4A5568;
  --ll-n-700: #1F2937;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  font-family: var(--font-sans);
  font-size: var(--t-base);
  line-height: var(--lh-normal);
  color: var(--fg);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

a { color: var(--color-tertiary); text-decoration: none; }
a:hover { color: var(--primary-hover); text-decoration: underline; text-underline-offset: 3px; }

/* ── Navigation ── */
/* Glassline: white surface, dark text, thin bottom border, no heavy chrome. */
.nav {
  background: var(--color-surface);
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--s-6);
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--border);
}
.nav-brand {
  font-family: var(--font-display);
  font-weight: var(--w-bold);
  font-size: 16px;
  color: var(--color-primary);
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 10px;
  letter-spacing: var(--track-tight);
}
.nav-brand:hover { color: var(--color-tertiary); text-decoration: none; }
.nav-brand .dot {
  width: 8px; height: 8px; border-radius: 2px;
  background: var(--color-tertiary);
  display: inline-block;
}
.nav-links { display: flex; gap: 4px; }
.nav-links a {
  color: var(--color-secondary);
  font-size: var(--t-sm);
  font-weight: var(--w-semi);
  padding: 6px 14px;
  border-radius: var(--r-sm);
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.nav-links a:hover { background: var(--color-neutral); color: var(--color-primary); }
.nav-links a.active { background: var(--color-neutral); color: var(--color-primary); }
.nav-user { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--fg-subtle); font-weight: var(--w-medium); }

/* Code blocks */
.code-block {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  background: var(--color-neutral);
  color: var(--color-primary);
  padding: 12px 16px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  overflow-x: auto;
  margin: 8px 0;
  white-space: pre;
}
code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--color-neutral);
  padding: 1px 6px;
  border-radius: var(--r-xs);
  color: var(--color-primary);
}

.nav-help {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: var(--r-sm);
  background: var(--color-neutral); color: var(--color-secondary);
  font-family: var(--font-sans); font-weight: var(--w-bold); font-size: 13px;
  border: 1px solid var(--border); cursor: pointer; line-height: 1;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.nav-help:hover { background: var(--color-tertiary); color: var(--color-on-primary); border-color: var(--color-tertiary); }
.nav-help:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* ─── First-run tour ─────────────────────────────────────────────────── */
.tour-overlay {
  position: fixed; inset: 0; background: rgba(15, 20, 25, 0.45);
  display: none; align-items: center; justify-content: center;
  z-index: 400; padding: 20px;
  backdrop-filter: blur(2px);
}
.tour-overlay.open { display: flex; }
.tour-card {
  background: var(--color-surface);
  border-radius: var(--r-lg);
  width: 100%; max-width: 560px;
  box-shadow: var(--shadow-xl);
  padding: 32px 36px;
  position: relative;
  font-family: var(--font-sans);
  animation: tourIn var(--dur-base) var(--ease-spring);
  border: 1px solid var(--border);
}
@keyframes tourIn {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.tour-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.tour-eyebrow {
  font-family: var(--font-mono);
  font-size: 11px; font-weight: var(--w-medium); letter-spacing: 0;
  text-transform: uppercase; color: var(--color-tertiary);
}
.tour-x {
  background: var(--color-neutral); color: var(--color-secondary);
  border: 1px solid var(--border); cursor: pointer;
  width: 32px; height: 32px; border-radius: var(--r-sm);
  font-size: 18px; line-height: 1; font-weight: 400;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background var(--dur-fast) var(--ease-out);
}
.tour-x:hover { background: var(--bg-sunken); }
.tour-title {
  font-family: var(--font-display);
  font-weight: var(--w-semi);
  font-size: 26px;
  line-height: 1.15;
  letter-spacing: var(--track-tight);
  color: var(--color-primary);
  margin: 0 0 18px;
}
.tour-body { font-size: 15px; line-height: 1.6; color: var(--color-secondary); }
.tour-body p { margin: 0 0 14px; }
.tour-body p:last-child { margin-bottom: 0; }
.tour-body ul { margin: 0 0 14px; padding-left: 22px; }
.tour-body li { margin: 6px 0; }
.tour-body strong { font-weight: var(--w-semi); color: var(--color-primary); }
.tour-footer {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; margin-top: 28px; padding-top: 20px;
  border-top: 1px solid var(--border);
}
.tour-dots { display: flex; gap: 6px; }
.tour-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--border-strong);
  transition: background var(--dur-fast) var(--ease-out);
}
.tour-dot.active { background: var(--color-tertiary); }
.tour-nav { display: flex; gap: 8px; }
.tour-btn {
  padding: 10px 20px; border-radius: var(--r-md);
  font-family: var(--font-sans); font-weight: var(--w-semi); font-size: 13px;
  border: none; cursor: pointer; line-height: 1;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.tour-btn-primary { background: var(--color-tertiary); color: var(--color-on-primary); }
.tour-btn-primary:hover { background: var(--primary-hover); }
.tour-btn-ghost { background: transparent; color: var(--color-secondary); border: 1px solid var(--border); }
.tour-btn-ghost:hover { background: var(--color-neutral); }
@media (max-width: 600px) {
  .tour-card { padding: 24px 22px; max-width: 100%; }
  .tour-title { font-size: 22px; }
}

/* ── Layout ── */
.container { max-width: 1200px; margin: 0 auto; padding: var(--s-8) var(--s-6); }

/* ── Page header ── */
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-4); margin-bottom: var(--s-8); flex-wrap: wrap; }
.page-title { font-family: var(--font-display); font-size: var(--t-3xl); font-weight: var(--w-semi); letter-spacing: var(--track-tight); line-height: var(--lh-tight); color: var(--color-primary); }
.page-subtitle { font-size: var(--t-sm); color: var(--fg-muted); margin-top: var(--s-2); }
.page-actions { display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; }

/* ── Section ── */
.section { margin-bottom: var(--s-10); }
.section-title {
  font-family: var(--font-mono);
  font-size: var(--t-xs);
  font-weight: var(--w-medium);
  text-transform: uppercase;
  letter-spacing: 0;
  color: var(--fg-muted);
  margin-bottom: var(--s-4);
}

/* ── Status banner ── */
.status-banner {
  border-radius: var(--r-md);
  padding: var(--s-4) var(--s-5);
  font-weight: var(--w-semi);
  font-size: var(--t-sm);
  margin-bottom: var(--s-8);
  display: flex;
  align-items: center;
  gap: var(--s-3);
  border: 1px solid;
}
.status-banner .indicator { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.status-banner.green { background: var(--color-success-bg); border-color: #BBF7D0; color: var(--color-success); }
.status-banner.green .indicator { background: var(--color-success); }
.status-banner.yellow { background: var(--color-warning-bg); border-color: #FDE68A; color: var(--color-warning); }
.status-banner.yellow .indicator { background: var(--color-warning); }
.status-banner.red { background: var(--color-danger-bg); border-color: #FCA5A5; color: var(--color-danger); }
.status-banner.red .indicator { background: var(--color-danger); }

/* ── Cards ── */
.card {
  background: var(--bg-elevated);
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  padding: 24px;
  box-shadow: var(--shadow-xs);
  transition: box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.card:hover { box-shadow: var(--shadow-sm); }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--s-5); margin-bottom: var(--s-10); }

/* ── Workflow card ── */
.workflow-card { display: flex; flex-direction: column; gap: var(--s-3); cursor: default; }
.workflow-card:hover { transform: translateY(-1px); }
.workflow-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-3); }
.workflow-name { font-weight: var(--w-semi); font-size: var(--t-md); color: var(--fg); line-height: var(--lh-snug); }
.workflow-desc { font-size: var(--t-sm); color: var(--fg-muted); line-height: var(--lh-normal); }
.workflow-meta { font-size: var(--t-xs); color: var(--fg-subtle); display: flex; gap: var(--s-4); align-items: center; flex-wrap: wrap; }
.workflow-actions { display: flex; gap: var(--s-2); margin-top: var(--s-1); flex-wrap: wrap; }

/* ── Badges ── */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: var(--r-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--w-medium);
  white-space: nowrap;
  text-transform: lowercase;
}
.badge::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.badge.success { background: var(--color-success-bg); color: var(--color-success); }
.badge.success::before { background: var(--color-success); }
.badge.failed  { background: var(--color-danger-bg); color: var(--color-danger); }
.badge.failed::before  { background: var(--color-danger); }
.badge.running { background: var(--color-running-bg); color: var(--color-running); }
.badge.running::before { background: var(--color-running); }
.badge.skipped { background: var(--color-neutral); color: var(--fg-muted); }
.badge.skipped::before { background: var(--fg-subtle); }

.runtime-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--w-medium);
  text-transform: lowercase;
  letter-spacing: 0;
  padding: 2px 7px;
  border-radius: var(--r-xs);
  background: var(--color-neutral);
  color: var(--color-secondary);
}

/* ── Toggle ── */
.toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-track {
  position: absolute; inset: 0;
  background: var(--border-strong);
  border-radius: 12px;
  cursor: pointer;
  transition: background var(--dur-base) var(--ease-out);
}
.toggle input:checked + .toggle-track { background: var(--color-tertiary); }
.toggle-track::after {
  content: '';
  position: absolute;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--color-surface);
  top: 3px; left: 3px;
  transition: transform var(--dur-base) var(--ease-spring);
  box-shadow: var(--shadow-xs);
}
.toggle input:checked + .toggle-track::after { transform: translateX(20px); }

/* ── Buttons ── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: 12px 20px;
  border-radius: var(--r-md);
  font-size: var(--t-sm);
  font-family: var(--font-sans);
  font-weight: var(--w-semi);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  text-decoration: none;
  white-space: nowrap;
  line-height: 1;
}
.btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.btn:active { transform: translateY(1px); }
.btn:disabled { opacity: .45; cursor: not-allowed; pointer-events: none; }

.btn-primary { background: var(--color-tertiary); color: var(--color-on-primary); border-color: var(--color-tertiary); }
.btn-primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.btn-run     { background: var(--color-tertiary); color: var(--color-on-primary); border-color: var(--color-tertiary); }
.btn-run:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.btn-edit    { background: var(--color-surface); color: var(--color-primary); border-color: var(--border); }
.btn-edit:hover { background: var(--color-neutral); border-color: var(--border-strong); }
.btn-ghost   { background: transparent; color: var(--fg-muted); border-color: var(--border); }
.btn-ghost:hover { background: var(--color-neutral); color: var(--fg); border-color: var(--border-strong); }
.btn-danger  { background: var(--color-danger-bg); color: var(--color-danger); border-color: #FCA5A5; }
.btn-danger:hover { background: var(--color-danger); color: var(--color-on-primary); border-color: var(--color-danger); }
.btn-sm  { padding: 8px 14px; font-size: var(--t-xs); }
.btn-lg  { padding: 14px 28px; font-size: var(--t-md); }
.btn-full{ width: 100%; }

/* ── Activity feed ── */
.feed { }
.feed-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3);
  border-bottom: 1px solid var(--border);
  font-size: var(--t-sm);
  cursor: pointer;
  border-radius: var(--r-sm);
  transition: background var(--dur-fast) var(--ease-out);
  margin-bottom: 2px;
  text-decoration: none;
  color: inherit;
}
.feed-row:hover { background: var(--bg-sunken); text-decoration: none; }
.feed-row.failed { border-left: 3px solid var(--color-danger); padding-left: calc(var(--s-3) - 3px); }
.feed-name { font-weight: var(--w-semi); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-primary); }
.feed-meta { color: var(--fg-muted); font-size: var(--t-xs); white-space: nowrap; }
.feed-dur  { color: var(--fg-subtle); font-size: var(--t-xs); white-space: nowrap; min-width: 48px; text-align: right; font-family: var(--font-mono); }

/* ── Run log viewer ── */
.log-viewer {
  background: #0F1419;
  color: #E5E7EB;
  border-radius: var(--r-md);
  padding: var(--s-6);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  overflow: auto;
  max-height: 560px;
}
.log-step { margin-bottom: 1px; display: flex; gap: var(--s-2); }
.log-ts { color: #6B7280; min-width: 90px; flex-shrink: 0; }
.log-type { min-width: 110px; flex-shrink: 0; }
.log-type-info     { color: #93C5FD; }
.log-type-api_call { color: #86EFAC; }
.log-type-api_response { color: #5EEAD4; }
.log-type-error    { color: #FCA5A5; font-weight: 600; }
.log-type-success  { color: #86EFAC; font-weight: 600; }
.log-msg { color: #E5E7EB; word-break: break-all; }
.log-detail { margin-left: 208px; color: #9CA3AF; font-size: 12px; white-space: pre-wrap; padding: 2px 0 6px; }

/* ── Settings / service cards ── */
.service-card { display: flex; align-items: center; gap: var(--s-4); flex-wrap: wrap; }
.service-name { font-weight: var(--w-semi); font-size: var(--t-md); flex: 1; color: var(--color-primary); }

.conn-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: var(--s-5);
}

.conn-card {
  background: var(--bg-elevated);
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-xs);
  padding: var(--s-5);
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  transition: box-shadow var(--dur-base) var(--ease-out);
}
.conn-card:hover { box-shadow: var(--shadow-sm); }

.conn-card-header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-3); }
.conn-card-title { font-family: var(--font-display); font-weight: var(--w-semi); font-size: var(--t-base); color: var(--color-primary); letter-spacing: var(--track-tight); }
.conn-card-actions { display: flex; align-items: center; gap: var(--s-2); }
.conn-recheck { font-size: var(--t-base); line-height: 1; padding: 0 var(--s-2); color: var(--fg-subtle); }
.conn-recheck:hover { color: var(--color-tertiary); }

.conn-msg {
  padding: var(--s-2) var(--s-3);
  background: var(--bg-sunken);
  border-radius: var(--r-sm);
  font-size: var(--t-xs);
  color: var(--fg-muted);
  line-height: var(--lh-normal);
}
.conn-status { font-family: var(--font-mono); font-size: 11px; font-weight: var(--w-medium); padding: 3px 9px; border-radius: var(--r-sm); }
.conn-status.ok       { background: var(--color-success-bg); color: var(--color-success); }
.conn-status.bad      { background: var(--color-danger-bg); color: var(--color-danger); }
.conn-status.checking { background: var(--bg-sunken); color: var(--fg-muted); }
.conn-rotated { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--fg-subtle); white-space: nowrap; }

/* ── Usage bar ── */
.usage-footer {
  background: var(--bg-sunken);
  border-top: 1px solid var(--border);
  padding: var(--s-4) var(--s-6);
  display: flex;
  gap: var(--s-8);
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: var(--t-xs);
  color: var(--fg-muted);
}
.usage-item { display: flex; align-items: center; gap: var(--s-2); }
.usage-bar { width: 80px; height: 4px; background: var(--border); border-radius: var(--r-pill); overflow: hidden; }
.usage-bar-fill { height: 100%; border-radius: var(--r-pill); background: var(--color-tertiary); transition: width .4s var(--ease-out); }
.usage-bar-fill.yellow { background: var(--color-warning); }
.usage-bar-fill.red    { background: var(--color-danger); }

/* ── Modal ── */
.modal-overlay {
  display: none;
  position: fixed; inset: 0;
  background: rgba(15,20,25,.45);
  z-index: 500;
  align-items: center;
  justify-content: center;
  padding: var(--s-5);
}
.modal-overlay.open { display: flex; }
.modal {
  background: var(--bg-elevated);
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  padding: var(--s-8);
  max-width: 560px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  position: relative;
}
.modal-title { font-family: var(--font-display); font-size: var(--t-xl); font-weight: var(--w-semi); margin-bottom: var(--s-5); letter-spacing: var(--track-tight); color: var(--color-primary); }
.modal-close { position: absolute; top: var(--s-5); right: var(--s-5); background: var(--bg-sunken); border: 1px solid var(--border); width: 32px; height: 32px; border-radius: var(--r-sm); cursor: pointer; font-size: 18px; color: var(--fg-muted); display: flex; align-items: center; justify-content: center; transition: background var(--dur-fast) var(--ease-out); }
.modal-close:hover { background: var(--color-neutral); color: var(--fg); }

/* ── Forms ── */
.form-group { margin-bottom: var(--s-5); }
.form-label { display: block; font-family: var(--font-mono); font-size: var(--t-xs); font-weight: var(--w-medium); color: var(--fg-muted); margin-bottom: var(--s-2); text-transform: uppercase; letter-spacing: 0; }
.form-input {
  width: 100%;
  padding: 10px var(--s-4);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  font-size: var(--t-sm);
  font-family: var(--font-sans);
  background: var(--bg-elevated);
  color: var(--fg);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  outline: none;
}
.form-input:focus { border-color: var(--color-tertiary); box-shadow: var(--focus-ring); }
.form-input[type=password] { letter-spacing: 3px; }
textarea.form-input { resize: vertical; min-height: 140px; font-family: var(--font-mono); font-size: 13px; letter-spacing: normal; }
.form-hint { font-size: var(--t-xs); color: var(--fg-subtle); margin-top: var(--s-1); }

/* ── Tables ── */
.table-wrap { overflow-x: auto; }
table.data { width: 100%; border-collapse: collapse; font-size: var(--t-sm); }
table.data th { text-align: left; font-family: var(--font-mono); font-size: var(--t-xs); font-weight: var(--w-medium); text-transform: uppercase; letter-spacing: 0; color: var(--fg-muted); padding: var(--s-3); border-bottom: 1px solid var(--border); white-space: nowrap; }
table.data td { padding: 11px var(--s-3); border-bottom: 1px solid var(--border); vertical-align: middle; }
table.data tr:last-child td { border-bottom: none; }
table.data tr.clickable { cursor: pointer; }
table.data tr.clickable:hover td { background: var(--bg-sunken); }
table.data tr.failed td:first-child { border-left: 3px solid var(--color-danger); padding-left: calc(var(--s-3) - 3px); }

/* ── Deploy progress ── */
.deploy-stages { display: flex; flex-direction: column; gap: 0; }
.deploy-stage { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) 0; font-size: var(--t-sm); }
.stage-icon { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; border: 1px solid; }
.stage-icon.pending  { border-color: var(--border); background: var(--bg-sunken); color: var(--fg-subtle); }
.stage-icon.active   { border-color: var(--color-running); background: var(--color-running-bg); color: var(--color-running); animation: spin 1s linear infinite; }
.stage-icon.done     { border-color: var(--color-success); background: var(--color-success-bg); color: var(--color-success); }
.stage-icon.fail     { border-color: var(--color-danger); background: var(--color-danger-bg); color: var(--color-danger); }
.stage-label { flex: 1; font-weight: var(--w-semi); }
.stage-detail { font-size: var(--t-xs); color: var(--fg-subtle); font-family: var(--font-mono); }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ── Misc ── */
hr.divider { border: none; border-top: 1px solid var(--border); margin: var(--s-6) 0; }
.text-muted { color: var(--fg-muted); }
.text-subtle { color: var(--fg-subtle); }
.text-sm { font-size: var(--t-sm); }
.text-xs { font-size: var(--t-xs); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

/* ── Copy button ── */
.copy-btn { font-size: var(--t-xs); font-weight: var(--w-semi); padding: 5px 12px; border-radius: var(--r-sm); background: var(--color-neutral); color: var(--color-secondary); border: 1px solid var(--border); cursor: pointer; transition: background var(--dur-fast); font-family: var(--font-sans); }
.copy-btn:hover { background: var(--color-tertiary); color: var(--color-on-primary); border-color: var(--color-tertiary); }

/* ── Flash notification ── */
.flash {
  position: fixed; bottom: 24px; right: 24px;
  padding: 12px 18px;
  border-radius: var(--r-md);
  font-weight: var(--w-semi);
  font-size: var(--t-sm);
  box-shadow: var(--shadow-lg);
  z-index: 600;
  animation: slideIn var(--dur-base) var(--ease-spring);
  border: 1px solid;
}
.flash.success { background: var(--color-success-bg); color: var(--color-success); border-color: #BBF7D0; }
.flash.error   { background: var(--color-danger-bg); color: var(--color-danger); border-color: #FCA5A5; }
@keyframes slideIn { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }

/* ── Info modal trigger ── */
.info-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--color-neutral); color: var(--fg-subtle);
  font-size: 11px; font-weight: var(--w-bold);
  cursor: pointer; border: 1px solid var(--border);
  transition: background var(--dur-fast);
  font-family: var(--font-sans);
  flex-shrink: 0;
}
.info-btn:hover { background: var(--color-tertiary); color: var(--color-on-primary); border-color: var(--color-tertiary); }

/* ── View toggle bar ── */
.view-toggle-bar {
  display: flex;
  gap: 3px;
  background: var(--color-neutral);
  border-radius: var(--r-md);
  padding: 3px;
  border: 1px solid var(--border);
  align-self: flex-end;
}
.view-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 30px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-subtle);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.view-btn:hover { background: var(--bg-elevated); color: var(--fg); }
.view-btn.active { background: var(--bg-elevated); color: var(--color-primary); box-shadow: var(--shadow-xs); }

/* ── Dash views ── */
.dash-view { margin-bottom: var(--s-8); }

/* ── Stack deck ── */
.stack-deck {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--s-5);
  margin-bottom: 4px;
}
.stack-nav { display: flex; align-items: center; justify-content: center; gap: var(--s-4); padding: var(--s-3) 0 var(--s-5); }
.stack-counter { font-family: var(--font-mono); font-size: var(--t-sm); font-weight: var(--w-medium); color: var(--fg-muted); min-width: 80px; text-align: center; }

/* ── Stack card ── */
.stack-card {
  background: var(--bg-elevated);
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  border-top: 2px solid var(--color-tertiary);
  box-shadow: var(--shadow-xs);
  padding: var(--s-5);
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  transition: box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.stack-card:hover { box-shadow: var(--shadow-sm); transform: translateY(-1px); }
.stack-card-header { display: flex; align-items: flex-start; gap: var(--s-2); }
.stack-card-name { font-weight: var(--w-semi); font-size: var(--t-base); line-height: var(--lh-snug); color: var(--color-primary); }
.stack-card-status { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
.stack-card-ts { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--fg-muted); }
.stack-card-no-run { font-size: var(--t-xs); color: var(--fg-subtle); }
.stack-card-next { font-family: var(--font-mono); font-size: var(--t-xs); font-weight: var(--w-medium); color: var(--fg-subtle); }
.stack-card-actions { display: flex; gap: var(--s-2); margin-top: auto; padding-top: var(--s-1); flex-wrap: wrap; }

/* ── Workflow list table ── */
.workflow-list-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--t-sm);
}
.workflow-list-table th {
  text-align: left;
  font-family: var(--font-mono);
  font-size: var(--t-xs);
  font-weight: var(--w-medium);
  text-transform: uppercase;
  letter-spacing: 0;
  color: var(--fg-muted);
  padding: var(--s-3) var(--s-4);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.workflow-list-table td { padding: 11px var(--s-4); border-bottom: 1px solid var(--border); vertical-align: middle; }
.workflow-list-table tr:last-child td { border-bottom: none; }
.workflow-list-table tr:hover td { background: var(--bg-sunken); }
.workflow-list-name { font-weight: var(--w-semi); color: var(--color-primary); text-decoration: none; }
.workflow-list-name:hover { color: var(--color-tertiary); text-decoration: none; }

/* ── Responsive ── */
@media (max-width: 640px) {
  .card-grid { grid-template-columns: 1fr; }
  .container { padding: var(--s-5) var(--s-4); }
  .page-header { flex-direction: column; align-items: stretch; }
  .workflow-actions { flex-wrap: wrap; }
  .nav-links { display: none; }
  .page-title { font-size: var(--t-xl); }
  .usage-footer { flex-direction: column; gap: var(--s-3); }
  .conn-grid { grid-template-columns: 1fr; }
  .stack-deck { grid-template-columns: 1fr; }
}
`;
