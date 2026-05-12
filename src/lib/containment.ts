// Paste-back containment: validates that AI-produced code edits are safe to send to GitHub.

export interface ContainmentResult {
  safe: boolean;
  reason?: string;
  flaggedPattern?: string;
}

const FORBIDDEN_FILE_PATTERNS = [
  /^wrangler\.toml$/,
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^\.github\//,
  /^src\/index\.ts$/,
  /^src\/scheduler\.ts$/,
  /^src\/queue-consumer\.ts$/,
  /^src\/lib\//,
  /^src\/objects\//,
  /^src\/api\//,
  /^src\/types\.ts$/,
  /^migrations\//,
];

// Patterns flagged in pasteback diffs. The intent is to catch obvious attempts
// to exfiltrate data or execute untrusted code that an LLM might have included
// (intentionally or by hallucination) — not to be a perfect firewall. Review
// the diff yourself before merging the PR.
//
// `outbound fetch` does NOT use an allowlist by default: scripts legitimately
// talk to many third-party APIs. If you want to enforce an allowlist for your
// deployment, add a rule below that includes only the hosts your scripts
// should ever reach. Example:
//   { name: 'fetch outside allowlist',
//     re: /fetch\s*\(\s*['"\`]https?:\/\/(?!api\.hubapi\.com|api\.stripe\.com)/ }
const EXFILTRATION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'eval()', re: /\beval\s*\(/ },
  { name: 'Function constructor', re: /new\s+Function\s*\(/ },
  { name: 'process.env access (Workers do not expose process.env)', re: /process\.env\b/ },
  { name: 'require() call (not allowed in Workers)', re: /\brequire\s*\(/ },
  { name: 'dynamic import of external URL', re: /import\s*\(\s*['"`]https?:\/\// },
  { name: 'base64 decode of secrets', re: /atob\s*\(\s*(?:env|context)\./i },
];

const KNOWN_SECRET_PATTERNS = [
  /re_[A-Za-z0-9]{20,}/,         // Resend
  /pat-[a-z0-9-]{20,}/,           // HubSpot
  /hs_[a-z0-9]{20,}/,             // HubSpot
  /sk-[A-Za-z0-9]{20,}/,          // generic
  /eyJ[A-Za-z0-9+/]{40,}/,        // JWT
];

export function checkContainment(
  workflowId: string,
  files: Record<string, string>,
  liveSecretValues: string[],
): ContainmentResult {
  for (const path of Object.keys(files)) {
    const allowedPrefix = `scripts/${workflowId}/`;
    if (!path.startsWith(allowedPrefix)) {
      return { safe: false, reason: `File path '${path}' is outside the allowed directory '${allowedPrefix}'. Only files inside scripts/${workflowId}/ can be modified via paste-back.` };
    }
    for (const pattern of FORBIDDEN_FILE_PATTERNS) {
      if (pattern.test(path)) {
        return { safe: false, reason: `File path '${path}' matches a forbidden pattern. Infrastructure files must be changed via direct GitHub commit.` };
      }
    }
  }

  for (const [path, content] of Object.entries(files)) {
    for (const { name, re } of EXFILTRATION_PATTERNS) {
      if (re.test(content)) {
        return { safe: false, reason: `File '${path}' contains a potentially unsafe pattern: ${name}.`, flaggedPattern: name };
      }
    }
    for (const re of KNOWN_SECRET_PATTERNS) {
      if (re.test(content)) {
        return { safe: false, reason: `File '${path}' appears to contain a secret token. Secrets must be stored in Settings → Connections, not hardcoded.`, flaggedPattern: 'hardcoded secret' };
      }
    }
    for (const secretValue of liveSecretValues) {
      if (secretValue.length > 8 && content.includes(secretValue)) {
        return { safe: false, reason: `File '${path}' contains a value that matches a live credential. Secrets must not appear in source code.`, flaggedPattern: 'live credential match' };
      }
    }
  }

  return { safe: true };
}

export function parsePasteback(raw: string): { ok: true; data: import('../types.js').PastebackEnvelope } | { ok: false; error: string } {
  const START = '<<<OPS-PASTEBACK v1>>>';
  const END = '<<<END>>>';
  const startIdx = raw.indexOf(START);
  const endIdx = raw.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { ok: false, error: 'Could not find OPS-PASTEBACK sentinels. Make sure you pasted the entire Claude Code response.' };
  }
  const jsonStr = raw.slice(startIdx + START.length, endIdx).trim();
  try {
    const data = JSON.parse(jsonStr) as import('../types.js').PastebackEnvelope;
    if (data.version !== 'v1') return { ok: false, error: 'Unknown pasteback version.' };
    if (!data.workflow_id) return { ok: false, error: 'Missing workflow_id in pasteback envelope.' };
    if (!data.parent_sha) return { ok: false, error: 'Missing parent_sha in pasteback envelope.' };
    if (!data.files || typeof data.files !== 'object') return { ok: false, error: 'Missing or invalid files map.' };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `Could not parse pasteback JSON: ${(e as Error).message}` };
  }
}
