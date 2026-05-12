// GitHub API integration for the paste-back deploy loop.
// Uses a Personal Access Token (PAT) — classic token with repo + workflow scopes.
// Create at: github.com/settings/tokens/new
// Store as a Workers Secret: wrangler secret put GITHUB_PAT

const GH_API = 'https://api.github.com';

async function ghFetch(
  path: string,
  method: string,
  body: unknown,
  pat: string,
): Promise<Response> {
  return fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ops-dashboard',
    },
    body: method !== 'GET' ? JSON.stringify(body) : undefined,
  });
}

export interface CreateBranchAndCommitResult {
  branchName: string;
  commitSha: string;
  prNumber: number;
  prUrl: string;
}

export async function createBranchAndCommit(
  pat: string,
  owner: string,
  repo: string,
  workflowId: string,
  files: Record<string, string>,
  parentSha: string,
): Promise<CreateBranchAndCommitResult> {
  const branchName = `pasteback/${workflowId}-${Date.now()}`;

  // Create branch from parent SHA
  const refResp = await ghFetch(`/repos/${owner}/${repo}/git/refs`, 'POST', {
    ref: `refs/heads/${branchName}`,
    sha: parentSha,
  }, pat);
  if (!refResp.ok) throw new Error(`Could not create branch: ${refResp.status} ${await refResp.text()}`);

  // Build tree with all changed files
  const treeItems = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const blobResp = await ghFetch(`/repos/${owner}/${repo}/git/blobs`, 'POST', {
        content: btoa(unescape(encodeURIComponent(content))),
        encoding: 'base64',
      }, pat);
      if (!blobResp.ok) throw new Error(`Could not create blob for ${path}: ${blobResp.status}`);
      const blob = await blobResp.json() as { sha: string };
      return { path, mode: '100644', type: 'blob', sha: blob.sha };
    }),
  );

  const treeResp = await ghFetch(`/repos/${owner}/${repo}/git/trees`, 'POST', {
    base_tree: parentSha,
    tree: treeItems,
  }, pat);
  if (!treeResp.ok) throw new Error(`Could not create tree: ${treeResp.status}`);
  const tree = await treeResp.json() as { sha: string };

  const commitResp = await ghFetch(`/repos/${owner}/${repo}/git/commits`, 'POST', {
    message: `ops-console: update ${workflowId} via paste-back`,
    tree: tree.sha,
    parents: [parentSha],
  }, pat);
  if (!commitResp.ok) throw new Error(`Could not create commit: ${commitResp.status}`);
  const commit = await commitResp.json() as { sha: string };
  const commitSha = commit.sha;

  // Update branch ref to new commit
  await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`, 'PATCH', {
    sha: commitSha,
    force: false,
  }, pat);

  // Open PR
  const prResp = await ghFetch(`/repos/${owner}/${repo}/pulls`, 'POST', {
    title: `ops-console: ${workflowId} paste-back update`,
    head: branchName,
    base: 'main',
    body: `Automated paste-back deploy from Ops Dashboard.\n\nWorkflow: \`${workflowId}\`\nParent SHA: \`${parentSha}\``,
  }, pat);
  if (!prResp.ok) throw new Error(`Could not open PR: ${prResp.status} ${await prResp.text()}`);
  const pr = await prResp.json() as { number: number; html_url: string };

  return { branchName, commitSha, prNumber: pr.number, prUrl: pr.html_url };
}

export async function getPrStatus(
  pat: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ state: string; mergeable: boolean | null; merged: boolean; checksStatus: string }> {
  const pr = await ghFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`, 'GET', {}, pat)
    .then(r => r.json()) as { state: string; mergeable: boolean | null; merged: boolean; head: { sha: string } };

  const checks = await ghFetch(`/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs`, 'GET', {}, pat)
    .then(r => r.json()) as { check_runs: Array<{ status: string; conclusion: string | null }> };

  const runs = checks.check_runs ?? [];
  let checksStatus = 'pending';
  if (runs.length > 0 && runs.every(r => r.status === 'completed')) {
    checksStatus = runs.every(r => r.conclusion === 'success') ? 'success' : 'failure';
  }

  return { state: pr.state, mergeable: pr.mergeable, merged: pr.merged, checksStatus };
}

export async function mergePr(
  pat: string,
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
): Promise<boolean> {
  const resp = await ghFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, 'PUT', {
    merge_method: 'squash',
    sha: commitSha,
  }, pat);
  return resp.ok;
}

export async function createRevertCommit(
  pat: string,
  owner: string,
  repo: string,
  workflowId: string,
  commitToRevert: string,
): Promise<CreateBranchAndCommitResult> {
  // Get the commit being reverted and its parent
  const commit = await ghFetch(`/repos/${owner}/${repo}/git/commits/${commitToRevert}`, 'GET', {}, pat)
    .then(r => r.json()) as { parents: Array<{ sha: string }>; tree: { sha: string } };

  const commitParentSha = commit.parents[0]?.sha;
  if (!commitParentSha) throw new Error('Cannot revert: commit has no parent');

  // Get current main HEAD
  const mainRef = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/main`, 'GET', {}, pat)
    .then(r => r.json()) as { object: { sha: string } };

  const branchName = `revert/${workflowId}-${Date.now()}`;
  await ghFetch(`/repos/${owner}/${repo}/git/refs`, 'POST', {
    ref: `refs/heads/${branchName}`,
    sha: mainRef.object.sha,
  }, pat);

  // Get the parent tree (state before the commit we're reverting)
  const parentCommit = await ghFetch(`/repos/${owner}/${repo}/git/commits/${commitParentSha}`, 'GET', {}, pat)
    .then(r => r.json()) as { tree: { sha: string } };

  const revertCommit = await ghFetch(`/repos/${owner}/${repo}/git/commits`, 'POST', {
    message: `ops-console: revert ${workflowId} to ${commitParentSha.slice(0, 7)}`,
    tree: parentCommit.tree.sha,
    parents: [mainRef.object.sha],
  }, pat).then(r => r.json()) as { sha: string };

  await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`, 'PATCH', {
    sha: revertCommit.sha,
    force: false,
  }, pat);

  const pr = await ghFetch(`/repos/${owner}/${repo}/pulls`, 'POST', {
    title: `ops-console: rollback ${workflowId}`,
    head: branchName,
    base: 'main',
    body: `Automated rollback from Ops Dashboard.\n\nReverts: \`${commitToRevert}\``,
  }, pat).then(r => r.json()) as { number: number; html_url: string };

  return { branchName, commitSha: revertCommit.sha, prNumber: pr.number, prUrl: pr.html_url };
}

export async function dispatchWorkflow(
  pat: string,
  owner: string,
  repo: string,
  workflowId: string,
  inputs: Record<string, string> = {},
): Promise<void> {
  const resp = await ghFetch(
    `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    'POST',
    { ref: 'main', inputs },
    pat,
  );
  if (!resp.ok) throw new Error(`GitHub dispatch failed: ${resp.status} ${await resp.text()}`);
}
