import assert from 'node:assert/strict'
import { assertCandidateScope, createRepairPullRequest, findRepairIssue, manifestPath, mergeCandidateCAS, notifyOnce, repairBrief, setRepairStateLabel } from './lib/catalog-repair-publication.mjs'

const id = `sha256:${'a'.repeat(64)}`, baseCommit = 'b'.repeat(40), sha = 'c'.repeat(40)
assert.match(manifestPath(id), /^docs\/catalog-repairs\/a+\.json$/)
assert.throws(() => manifestPath('../../etc'), /identity/)
const brief = repairBrief({ id, baseCommit, articleIds: ['kb4934'], outcome: 'applied-awaiting-review', approach: '<script>@intruder', checks: ['fixture replay'], headCommit: sha })
assert.ok(brief.includes('&lt;script&gt;&#64;intruder'))
assert.ok(brief.includes(`/blob/${sha}/docs/catalog-repairs/`))
assert.ok(brief.includes('passing tests alone'))
const issue = { labels: [{ name: 'custom-review-label' }, { name: 'needs-investigation' }], body: `${brief}\nReviewer detail to preserve.` }
await setRepairStateLabel(async (path, options = {}) => {
  if (!options.method) return issue
  if (path.endsWith('/labels')) { assert.deepEqual(options.body.labels, ['custom-review-label', 'catalog-review', 'applied-awaiting-review']); return {} }
  assert.equal(options.body.body, issue.body.replace('Catalog repair: **applied-awaiting-review**.', 'Catalog repair: **applied awaiting review**.'))
  return {}
}, 12, 'applied-awaiting-review')
let comments = [], fail = true, posted = 0
const api = async (path, options = {}) => {
  if (path.startsWith('/issues?')) return [{ body: `<!-- catalog-repair:${id} -->`, number: 88, user: { id: 55, type: 'User' } }]
  if (options.method === 'POST') {
    if (fail) throw new Error('simulated notification outage')
    const created = { id: ++posted, body: options.body.body, user: { type: 'Bot', login: 'github-actions[bot]' }, html_url: 'https://github.com/TnTBass/UpgradeBrief/issues/4#issuecomment-1' }
    comments.push(created); return created
  }
  if (path.startsWith('/issues/comments/')) return comments.at(-1)
  return comments
}
assert.equal(await findRepairIssue(api, id), null, 'Public issue markers cannot impersonate the repair bot')
await assert.rejects(notifyOnce(api, 4, 'applied', 'Repair applied'), /outage/)
fail = false
assert.equal((await notifyOnce(api, 4, 'applied', 'Repair applied')).duplicate, false)
assert.equal((await notifyOnce(api, 4, 'applied', 'Repair applied')).duplicate, true)
assert.equal(posted, 1)
await assert.rejects(createRepairPullRequest(api, { id, baseCommit, files: { 'scripts/evil.mjs': 'x' } }), /forbidden/)
const scopeApi = async path => path.startsWith('/git/commits/') ? { parents: [{ sha: baseCommit }] } : { commits: [{}], files: [{ filename: 'src/data/catalog.snapshot.json', status: 'modified' }] }
assert.deepEqual(await assertCandidateScope(scopeApi, { sha, baseCommit, id }), ['src/data/catalog.snapshot.json'])
await assert.rejects(assertCandidateScope(async path => path.startsWith('/git/commits/') ? { parents: [{ sha: baseCommit }] } : { commits: [{}], files: [{ filename: '.github/workflows/verify.yml', status: 'modified' }] }, { sha, baseCommit, id }), /data-only/)
console.log('Publication tests passed: immutable evidence links, exact candidate scope, untrusted-marker refusal, notification recovery and dedupe.')

for (const environment of ['production', 'trial']) {
  const baseBranch = environment === 'production' ? 'main' : 'codex/catalog-repair-trial'
  let main = baseCommit, concurrent = false
  const mergeApi = async (path, { method, body } = {}) => {
    if (path === `/git/commits/${sha}`) return { parents: [{ sha: baseCommit }], tree: { sha: 'tree' } }
    if (path === `/git/ref/heads/${baseBranch}`) return { object: { sha: main } }
    if (path === '/git/commits') { assert.deepEqual(body.parents, [baseCommit, sha]); assert.equal(body.tree, 'tree'); if (concurrent) main = 'new-main'; return { sha: 'merge' } }
    if (path === `/git/refs/heads/${baseBranch}` && method === 'PATCH') { assert.equal(body.force, false); if (main !== baseCommit) throw new Error('non-fast-forward'); main = body.sha; return {} }
    throw new Error(`Unexpected merge mutation ${path}`)
  }
  assert.equal((await mergeCandidateCAS(mergeApi, { sha, baseCommit, number: 1, environment })).sha, 'merge')
  main = baseCommit; concurrent = true
  await assert.rejects(mergeCandidateCAS(mergeApi, { sha, baseCommit, number: 1, environment }), /non-fast-forward/)
  assert.equal(main, 'new-main', 'Concurrent main work must not be overwritten')
}
