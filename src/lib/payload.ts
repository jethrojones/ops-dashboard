// Generates Edit Payload and Copy-for-Claude debug payload.

import type { Script, Run, RunLog } from '../types.js';

export function buildEditPayload(
  script: Script,
  recentRuns: Run[],
  sourceFiles: Record<string, string>,
): string {
  const runSummary = recentRuns.slice(0, 5).map(r =>
    `  - ${r.started_at} | ${r.status}${r.error_summary ? ` | ${r.error_summary}` : ''}`
  ).join('\n') || '  (no recent runs)';

  const filesSection = Object.keys(sourceFiles).length > 0
    ? Object.entries(sourceFiles)
        .map(([path, content]) => `### ${path}\n\`\`\`typescript\n${content}\n\`\`\``)
        .join('\n\n')
    : `> Source files could not be fetched from GitHub (GITHUB_PAT is not configured in the Worker).\n> Read these files from disk before making any changes:\n> - scripts/${script.id}/script.ts\n> - scripts/${script.id}/script.test.ts\n> - scripts/${script.id}/SKILL.md`;

  return `# Ops Dashboard — Edit Payload
# Workflow: ${script.name} (${script.id})
# Runtime: ${script.runtime}
# Parent SHA: ${script.version_sha ?? 'none'}

## Instructions
You are editing a Ops Dashboard workflow. Follow these steps exactly:
1. Read all files below thoroughly.
2. Update the test in script.test.ts FIRST to capture the desired new behavior. Confirm it fails.
3. Edit script.ts until the tests pass.
4. Run the full test suite. Do not produce output if any tests are failing.
5. Return your result using the paste-back format below — no other format will be accepted.

## Workflow Description
${script.description}

## Recent Run History
${runSummary}

## Source Files
${filesSection}

## Paste-back Format
Wrap your entire response in these sentinels. The JSON must be valid.

<<<OPS-PASTEBACK v1>>>
{
  "version": "v1",
  "workflow_id": "${script.id}",
  "parent_sha": "${script.version_sha ?? ''}",
  "files": {
    "scripts/${script.id}/script.ts": "<full file content>",
    "scripts/${script.id}/script.test.ts": "<full file content>",
    "scripts/${script.id}/SKILL.md": "<full file content — update if failure modes changed>"
  }
}
<<<END>>>

Only include files you actually changed. You may NOT include files outside scripts/${script.id}/.
`;
}

export function buildDebugPayload(
  script: Script,
  run: Run,
  log: RunLog,
  sourceFiles: Record<string, string>,
): string {
  const logText = log.steps.map(s => {
    const prefix = `[${s.ts}] [${s.type.toUpperCase()}]`;
    const detail = s.detail ? `\n  detail: ${JSON.stringify(s.detail, null, 2).replace(/\n/g, '\n  ')}` : '';
    return `${prefix} ${s.message}${detail}`;
  }).join('\n');

  const filesSection = Object.keys(sourceFiles).length > 0
    ? Object.entries(sourceFiles)
        .map(([path, content]) => `### ${path}\n\`\`\`typescript\n${content}\n\`\`\``)
        .join('\n\n')
    : `> Source files could not be fetched from GitHub (GITHUB_PAT is not configured in the Worker).\n> Read these files from disk before making any changes:\n> - scripts/${script.id}/script.ts\n> - scripts/${script.id}/script.test.ts\n> - scripts/${script.id}/SKILL.md`;

  return `# Ops Dashboard — Debug Payload
# Workflow: ${script.name} (${script.id})
# Run ID: ${run.id}
# Status: ${run.status}
# Started: ${run.started_at}
# Duration: ${run.duration_ms != null ? `${run.duration_ms}ms` : 'unknown'}
# Trigger: ${run.trigger_type}${run.trigger_detail ? ` (${run.trigger_detail})` : ''}
# Error category: ${run.error_category ?? 'none'}
# Version SHA: ${run.version_sha ?? 'unknown'}

## Instructions
A Ops Dashboard workflow has failed. Follow these steps:
1. Read the full verbose log below carefully.
2. Identify the root cause. State it plainly in one sentence.
3. Write a test in script.test.ts that would reproduce the failure. Confirm it fails.
4. Fix script.ts until the test passes AND the full test suite passes.
5. Return using the paste-back format at the bottom.

## Error Summary
${run.error_summary ?? '(no summary available)'}

## Verbose Log
\`\`\`
${logText || '(no log available)'}
\`\`\`

## Source Files (as of failing run)
${filesSection}

## Paste-back Format
<<<OPS-PASTEBACK v1>>>
{
  "version": "v1",
  "workflow_id": "${script.id}",
  "parent_sha": "${script.version_sha ?? ''}",
  "files": {
    "scripts/${script.id}/script.ts": "<full file content>",
    "scripts/${script.id}/script.test.ts": "<full file content>"
  }
}
<<<END>>>
`;
}

export function categorizeError(errorMessage: string): { category: string; summary: string } {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('authentication') || msg.includes('invalid token') || msg.includes('api key')) {
    return {
      category: 'auth',
      summary: 'The workflow failed with an authentication error. The most likely cause is that an API key is expired or has been revoked. Log in to the console and check Settings → Connections.',
    };
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return {
      category: 'rate_limit',
      summary: 'The workflow was rate-limited by an external API. This usually resolves on its own — the next scheduled run should succeed. If it keeps happening, check Settings → Connections for any API key issues.',
    };
  }
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnreset') || msg.includes('enotfound') || msg.includes('fetch failed')) {
    return {
      category: 'network',
      summary: 'The workflow failed with a network error. This is usually transient — the next scheduled run should succeed. If it keeps happening, the external service may be down.',
    };
  }
  if (msg.includes('schema') || msg.includes('parse') || msg.includes('json') || msg.includes('unexpected token') || msg.includes('cannot read')) {
    return {
      category: 'schema',
      summary: 'The workflow received data in an unexpected format from an external API. This usually means the API changed its response shape. Use Copy for Claude to diagnose.',
    };
  }
  return {
    category: 'unknown',
    summary: 'The workflow failed with an unexpected error. Use Copy for Claude to diagnose.',
  };
}
