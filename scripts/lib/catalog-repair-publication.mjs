import { createHash } from 'node:crypto'

export const REPAIR_DATA_PATHS = ['scripts/data/reviewed-security-advisories.json', 'scripts/data/security-review-baselines.json', 'src/data/catalog.snapshot.json']
export const TRIAL_BRANCH = 'codex/catalog-repair-trial'
export function repairBaseBranch(environment) {
  if (!['production', 'trial'].includes(environment)) throw new Error('Unknown repair environment')
  return environment === 'trial' ? TRIAL_BRANCH : 'main'
}
export const manifestPath = id => {
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('Invalid repair identity')
  return `docs/catalog-repairs/${id.slice(7)}.json`
}
const hash = value => createHash('sha256').update(value).digest('hex')
const safe = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@/g, '&#64;')
const trustedAuthor = user => user?.id === 1081294 || (user?.type === 'Bot' && user.login === 'github-actions[bot]')

export function repairBrief({ id, baseCommit, articleIds, outcome, approach, checks, changes = [], blocked = [], repository = 'TnTBass/UpgradeBrief', headCommit }) {
  const verification = checks.length > 10
    ? `${checks.length} checks passed, including ${checks.filter(check => ['live-refresh', 'app-tests', 'catalog', 'typescript', 'build', 'fresh-source-verification'].includes(check)).join(', ')}. The complete check list is in the linked evidence`
    : checks.join(', ') || 'No candidate checks completed'
  return [
    `<!-- catalog-repair:${id} -->`,
    `Catalog repair: **${safe(outcome)}**.`, '',
    `**What changed:** ${articleIds.map(safe).join(', ') || 'Refresh failure without complete source evidence'}.`,
    ...changes.map(change => safe(change)), '',
    `**Approach:** ${safe(approach)}`, '',
    `**Verified:** ${safe(verification)}.`,
    ...(blocked.length ? [`**Needs attention:** ${blocked.map(safe).join('; ')}.`] : []), '',
    `Base: \`${baseCommit}\`.${headCommit ? ` Candidate: \`${headCommit}\`.` : ''}`,
    `Repair: \`${id}\`.`,
    ...(headCommit ? [`[Exact evidence and before/after security records](https://github.com/${repository}/blob/${headCommit}/${manifestPath(id)})`] : []), '',
    '**Review afterward:** leave a normal comment such as “use a different approach.” A trusted reviewer’s concern places this repair on hold. “Please revert this” requests a scoped revert. Other corrections become linked implementation work when they exceed the supported data rules.',
    'A ChatGPT/Dot reviewer should inspect the linked source evidence and exact commit, then report supported, changes needed, or insufficient evidence. The brief and passing tests alone are not independent proof.',
  ].join('\n')
}

export async function ensureLabels(api) {
  for (const [name, color] of [['catalog-review', '5319e7'], ['applied-awaiting-review', '0e8a16'], ['needs-investigation', 'd93f0b'], ['changes-requested', 'b60205'], ['corrected', '1d76db'], ['stale', 'cccccc']]) {
    if (!await api(`/labels/${name}`, { allow404: true })) await api('/labels', { method: 'POST', body: { name, color } })
  }
}

export async function setRepairStateLabel(api, number, name) {
  const states = ['applied-awaiting-review', 'needs-investigation', 'changes-requested', 'corrected', 'stale']
  if (!states.includes(name)) throw new Error('Unknown repair lifecycle label')
  const issue = await api(`/issues/${number}`)
  const labels = issue.labels.map(label => typeof label === 'string' ? label : label.name).filter(label => !states.includes(label))
  await api(`/issues/${number}/labels`, { method: 'PUT', body: { labels: [...new Set([...labels, 'catalog-review', name])] } })
  // Keep the first line of the skim brief current after publication/correction.
  // Preserve the rest, including any reviewer edits to the explanation.
  if (/^<!-- catalog-repair:sha256:[a-f0-9]{64} -->\nCatalog repair: \*\*[^\n]+\*\*\./.test(issue.body ?? '')) {
    const body = issue.body.replace(/\nCatalog repair: \*\*[^\n]+\*\*\./, `\nCatalog repair: **${name.replaceAll('-', ' ')}**.`)
    if (body !== issue.body) await api(`/issues/${number}`, { method: 'PATCH', body: { body } })
  }
}

export async function persistRepairEvidence(api, id, manifest) {
  const path = manifestPath(id)
  const content = `${JSON.stringify(manifest, null, 2)}\n`
  if (Buffer.byteLength(content) > 5_000_000) throw new Error('Evidence manifest exceeds durable storage limit')
  // Immutable notes refs retain blocked evidence without deploying a branch.
  const refName = `notes/catalog-repair-evidence/${id.slice(7)}`
  const refs = await api(`/git/matching-refs/${refName}`)
  const existing = refs.find(item => item.ref === `refs/${refName}`)
  if (existing) return existing.object.sha
  const blob = await api('/git/blobs', { method: 'POST', body: { content, encoding: 'utf-8' } })
  const tree = await api('/git/trees', { method: 'POST', body: { tree: [{ path, sha: blob.sha, mode: '100644', type: 'blob' }] } })
  const commit = await api('/git/commits', { method: 'POST', body: { message: `Catalog repair evidence ${id}`, tree: tree.sha, parents: [] } })
  await api('/git/refs', { method: 'POST', body: { ref: `refs/${refName}`, sha: commit.sha } })
  return commit.sha
}

export async function findRepairIssue(api, id) {
  // Search all states: an unchanged, already closed failure must not reopen daily.
  for (let page = 1; page <= 10; page++) {
    const issues = await api(`/issues?state=all&labels=catalog-review&per_page=100&page=${page}`)
    const match = issues.find(item => trustedAuthor(item.user) && item.body?.includes(`<!-- catalog-repair:${id} -->`))
    if (match) return match
    if (issues.length < 100) return null
  }
  throw new Error('Repair inbox exceeds bounded scan; refusing possible duplicate')
}

export async function ensureInvestigation(api, { id, title, body }) {
  const existing = await findRepairIssue(api, id)
  if (existing) return existing
  return api('/issues', { method: 'POST', body: { title, body, labels: ['catalog-review', 'needs-investigation'] } })
}

export async function notifyOnce(api, number, key, message) {
  const marker = `<!-- catalog-notification:${hash(key)} -->`
  for (let page = 1; page <= 10; page++) {
    const comments = await api(`/issues/${number}/comments?per_page=100&page=${page}`)
    if (comments.some(comment => trustedAuthor(comment.user) && comment.body?.includes(marker))) return { recorded: true, duplicate: true }
    if (comments.length < 100) {
      const created = await api(`/issues/${number}/comments`, { method: 'POST', body: { body: `${marker}\n@TnTBass ${message}` } })
      const readBack = await api(`/issues/comments/${created.id}`)
      if (readBack.body !== created.body || !readBack.body.includes(marker)) throw new Error('Notification comment read-back failed')
      return { recorded: true, duplicate: false, url: readBack.html_url }
    }
  }
  throw new Error('Notification history exceeds bounded scan')
}

export async function createRepairPullRequest(api, { id, baseCommit, baseBranch = 'main', files, manifest, title, brief }) {
  if (!/^[a-f0-9]{40}$/.test(baseCommit) || !/^[\w/-]+$/.test(baseBranch)) throw new Error('Invalid candidate base')
  if (Object.keys(files).some(path => !REPAIR_DATA_PATHS.includes(path))) throw new Error('Candidate modifies a forbidden path')
  const path = manifestPath(id)
  const allFiles = { ...files, [path]: `${JSON.stringify(manifest, null, 2)}\n` }
  const branch = `codex/catalog-repair-${id.slice(7, 19)}-${baseCommit.slice(0, 8)}`
  const old = await findRepairIssue(api, id)
  const base = await api(`/git/commits/${baseCommit}`)
  const treeEntries = []
  for (const [path, content] of Object.entries(allFiles)) {
    const blob = await api('/git/blobs', { method: 'POST', body: { content, encoding: 'utf-8' } })
    treeEntries.push({ path, sha: blob.sha, mode: '100644', type: 'blob' })
  }
  const tree = await api('/git/trees', { method: 'POST', body: { base_tree: base.tree.sha, tree: treeEntries } })
  if (old?.pull_request) {
    const pull = await api(`/pulls/${old.number}`)
    const previous = await api(`/git/commits/${pull.head.sha}`)
    if (previous.parents.length === 1 && previous.parents[0].sha === baseCommit) {
      if (pull.state !== 'open' || previous.tree.sha !== tree.sha) throw new Error('Existing candidate differs or was closed; preserving it for investigation')
      return { pull, existing: true }
    }
    await api(`/issues/${pull.number}/labels`, { method: 'POST', body: { labels: ['stale'] } })
  }
  let ref = await api(`/git/ref/heads/${branch}`, { allow404: true })
  if (ref) {
    const existing = await api(`/git/commits/${ref.object.sha}`)
    if (existing.tree.sha !== tree.sha || existing.parents.length !== 1 || existing.parents[0].sha !== baseCommit) throw new Error('Candidate branch has different content; preserving possible human edits')
  } else {
    const commit = await api('/git/commits', { method: 'POST', body: { message: title, tree: tree.sha, parents: [baseCommit] } })
    ref = await api('/git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit.sha } })
  }
  const pull = await api('/pulls', { method: 'POST', body: { title, body: brief(ref.object.sha), head: branch, base: baseBranch } })
  await api(`/issues/${pull.number}/labels`, { method: 'POST', body: { labels: ['catalog-review'] } })
  return { pull, existing: false }
}

export async function assertCandidateScope(api, { sha, baseCommit, id }) {
  const commit = await api(`/git/commits/${sha}`)
  if (commit.parents.length !== 1 || commit.parents[0].sha !== baseCommit) throw new Error('Candidate parent changed')
  const comparison = await api(`/compare/${baseCommit}...${sha}`)
  const paths = new Set([...REPAIR_DATA_PATHS, manifestPath(id)])
  if (comparison.commits.length !== 1 || !comparison.files?.length || comparison.files.some(file => !paths.has(file.filename) || !['added', 'modified'].includes(file.status))) throw new Error('Candidate scope is not data-only')
  return comparison.files.map(file => file.filename)
}

export async function mergeCandidateCAS(api, { sha, baseCommit, number, environment = 'production' }) {
  const baseBranch = repairBaseBranch(environment)
  const candidate = await api(`/git/commits/${sha}`)
  if (candidate.parents.length !== 1 || candidate.parents[0].sha !== baseCommit) throw new Error('Candidate parent changed')
  if ((await api(`/git/ref/heads/${baseBranch}`)).object.sha !== baseCommit) throw new Error('Base branch changed before publication')
  // The merge tree is the exact tested candidate. Its parents include the
  // observed main and PR head. A non-forced ref update rejects any intervening
  // main commit, including the race that a separate base check cannot prevent.
  const commit = await api('/git/commits', { method: 'POST', body: { message: `Merge validated catalog repair #${number}`, tree: candidate.tree.sha, parents: [baseCommit, sha] } })
  try {
    await api(`/git/refs/heads/${baseBranch}`, { method: 'PATCH', body: { sha: commit.sha, force: false } })
  } catch (error) {
    if ((await api(`/git/ref/heads/${baseBranch}`)).object.sha !== commit.sha) throw error
  }
  return { sha: commit.sha, merged: true }
}

export async function waitForExactVerification(api, { sha, baseCommit, id, environment = 'production', sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  repairBaseBranch(environment)
  await api('/actions/workflows/verify.yml/dispatches', { method: 'POST', body: { ref: 'main', inputs: { candidate_commit: sha, candidate_base: baseCommit, repair_id: id, environment } } })
  for (let attempt = 0; attempt < 60; attempt++) {
    const checks = await api(`/commits/${sha}/check-runs?check_name=Catalog%20repair%20verified&filter=latest`)
    const check = checks.check_runs.find(item => item.name === 'Catalog repair verified' && item.app?.slug === 'github-actions' && item.head_sha === sha)
    if (check?.status === 'completed') {
      if (check.conclusion !== 'success') throw new Error('Exact candidate verification failed')
      return check.html_url
    }
    await sleep(15_000)
  }
  throw new Error('Exact candidate verification did not finish within fifteen minutes')
}
