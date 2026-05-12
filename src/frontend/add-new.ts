import { layout } from './layout.js';
import { ADD_SCRIPT_SKILL_MD } from '../skill-content.js';

export interface AddNewData {
  userEmail: string;
}

export function addNewPage(d: AddNewData): string {
  const skillEncoded = encodeURIComponent(ADD_SCRIPT_SKILL_MD);

  const content = `
<div class="container">
  <div class="page-header">
    <div>
      <h1 class="page-title">Add a new automation</h1>
      <p class="page-subtitle">Each automation is a folder under <code>scripts/</code> plus one line in the registry. Use an LLM to scaffold it for you, or write it by hand.</p>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Before you start — one-time setup</div>
    <div class="card" style="padding:var(--s-6);">
      <ol style="margin:0;padding-left:22px;line-height:1.7;font-size:var(--t-sm);">
        <li style="margin-bottom:14px;">
          <strong>The repo is on your computer.</strong> Clone it, then <code>cd</code> in and install:
          <pre class="code-block">git clone &lt;your fork or this repo&gt;
cd ops-dashboard
npm install</pre>
        </li>
        <li style="margin-bottom:14px;">
          <strong>Cloudflare Wrangler is authenticated.</strong>
          <pre class="code-block">npx wrangler login</pre>
        </li>
        <li>
          <strong>You can deploy.</strong> Verify with:
          <pre class="code-block">npm run deploy</pre>
        </li>
      </ol>
    </div>
  </div>

  <div class="section">
    <div class="section-title">The "add-script" skill (optional, recommended)</div>
    <div class="card" style="padding:var(--s-6);">
      <p style="margin:0 0 var(--s-4);">If you use Claude Code or another LLM CLI that supports skills, this repo ships an <code>ops-add-script</code> skill. It walks the model through the full 10-step setup: metadata, code, registry, D1 row, schedule row, deploy. Without it the model is more likely to skip a step (missing D1 row = invisible workflow; missing <code>next_run_at</code> = cron never fires).</p>
      <p style="margin:0 0 var(--s-4);"><strong>Two ways to install it</strong>:</p>
      <ul style="margin:0 0 var(--s-3);padding-left:22px;line-height:1.7;font-size:var(--t-sm);">
        <li><strong>Project-local (already done):</strong> the skill lives at <code>.claude/skills/ops-add-script/</code> in this repo. Claude Code picks it up automatically when run from this folder.</li>
        <li><strong>Global:</strong> drop it in <code>~/.claude/skills/ops-add-script/</code> to use it from any folder.</li>
      </ul>
      <button class="btn btn-primary btn-sm" onclick="downloadSkill()">Download SKILL.md</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">The 10-step pattern (skim this once)</div>
    <div class="card" style="padding:var(--s-6);">
      <ol style="margin:0;padding-left:22px;line-height:1.7;font-size:var(--t-sm);">
        <li><code>scripts/&lt;id&gt;/metadata.json</code> — id, name, description, schedule, triggers, params_schema, required_secrets.</li>
        <li><code>scripts/&lt;id&gt;/script.ts</code> — exports <code>async function run(ctx, params)</code>.</li>
        <li><code>npm run typecheck</code> — must pass.</li>
        <li>Register in <code>src/script-registry.ts</code> — add an import + map entry.</li>
        <li>Migration if you need a new D1 table (skip otherwise).</li>
        <li><strong>Insert row into the <code>scripts</code> D1 table</strong> — until this exists, the workflow is invisible on the dashboard.</li>
        <li>Insert row into the <code>schedules</code> table (for cron scripts) with a non-null <code>next_run_at</code>.</li>
        <li>Confirm the worker's own cron in <code>wrangler.toml</code> covers your script's firing window.</li>
        <li><code>npm run deploy</code>.</li>
        <li><code>scripts/&lt;id&gt;/SKILL.md</code> — purpose, params, failure modes, schedule.</li>
      </ol>
      <p style="margin:var(--s-4) 0 0;font-size:var(--t-sm);color:var(--fg-muted);">See <code>docs/adding-scripts.md</code> in the repo for the full version with SQL examples.</p>
    </div>
  </div>

  <div class="section">
    <div class="section-title">If your script needs an API key</div>
    <div class="card" style="padding:var(--s-6);">
      <ol style="margin:0;padding-left:22px;line-height:1.7;font-size:var(--t-sm);">
        <li>Go to <a href="/settings/connections">Settings → Connections</a>.</li>
        <li>Find the service. If it's not listed yet, add an entry to <code>SERVICE_INFO</code> in <code>src/frontend/settings.ts</code>.</li>
        <li>Paste the key into the form and save. The console encrypts it with AES-GCM before storing.</li>
        <li>List the same service key in your script's <code>required_secrets</code>. The runtime loads it into <code>ctx.secrets.&lt;key&gt;</code>.</li>
      </ol>
      <p style="margin:var(--s-4) 0 0;font-size:var(--t-sm);color:var(--fg-muted);"><strong>Never paste API keys into chat with the LLM.</strong> They go in the Connections form only.</p>
    </div>
  </div>

  <div class="section">
    <div class="section-title">After deploy — test it</div>
    <div class="card" style="padding:var(--s-6);">
      <ol style="margin:0;padding-left:22px;line-height:1.7;font-size:var(--t-sm);">
        <li>Refresh the <a href="/">Dashboard</a>. Your new workflow should appear.</li>
        <li>Click <strong>Run now</strong>. Leave <code>dry_run</code> <em>on</em> for the first run. Open the run detail and read the log.</li>
        <li>If the log looks correct, run again with <code>dry_run</code> off.</li>
        <li>If it's scheduled, you're done — the next cron tick will fire it.</li>
        <li>If a future run fails, you'll get an email (assuming you set up Resend + added yourself in Notifications). The run detail page has a <strong>Copy for Claude</strong> button that bundles source + log + error.</li>
      </ol>
    </div>
  </div>
</div>

<script>
const SKILL_TEXT = decodeURIComponent("${skillEncoded}");
function downloadSkill() {
  const blob = new Blob([SKILL_TEXT], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'SKILL.md';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}
</script>
`;

  return layout(content, { title: 'Add new', activeNav: 'add-new', userEmail: d.userEmail });
}
