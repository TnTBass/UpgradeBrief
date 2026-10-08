import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { githubClient } from './lib/catalog-repair-state.mjs'
import { TRIAL_BRANCH, REPAIR_DATA_PATHS } from './lib/catalog-repair-publication.mjs'
import { createSecurityReviewBaseline } from './lib/security-review-baselines.mjs'
import { repairHash } from './lib/catalog-repair-evidence.mjs'

if (process.env.GITHUB_REPOSITORY !== 'TnTBass/UpgradeBrief') throw new Error('Trial repository differs')
const api = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN })
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if ((await api('/git/ref/heads/main')).object.sha !== sha) throw new Error('Trial seed must use current trusted main')
const values = await Promise.all(REPAIR_DATA_PATHS.map(async path => JSON.parse(await readFile(path, 'utf8'))))
const [data, baselines, catalog] = values
const fixture = JSON.parse(await readFile('scripts/fixtures/catalog-repair/supported-semantics.json', 'utf8'))
if (baselines.articles.kb4857.normalizedText !== fixture.informational.after) throw new Error('Trial fixture is stale; update it through maintained review')
const before = fixture.informational.before
data.observationSpecs.kb4857.contentFingerprint = repairHash(before)
baselines.articles.kb4857 = createSecurityReviewBaseline('kb4857', before, repairHash(before))
catalog.securityFeedPageStates.find(item => item.articleId === 'kb4857').contentFingerprint = repairHash(before)
const base = await api(`/git/commits/${sha}`)
const entries = []
for (let i = 0; i < values.length; i++) {
  const blob = await api('/git/blobs', { method: 'POST', body: { content: `${JSON.stringify(values[i], null, 2)}\n`, encoding: 'utf-8' } })
  entries.push({ path: REPAIR_DATA_PATHS[i], sha: blob.sha, mode: '100644', type: 'blob' })
}
const tree = await api('/git/trees', { method: 'POST', body: { base_tree: base.tree.sha, tree: entries } })
const existing = await api(`/git/ref/heads/${TRIAL_BRANCH}`, { allow404: true })
if (existing) {
  const previous = await api(`/git/commits/${existing.object.sha}`)
  if (previous.tree.sha !== tree.sha) throw new Error('Trial branch already contains different work; preserving it')
  console.log(`Reusing isolated trial seed ${existing.object.sha}`)
} else {
  const commit = await api('/git/commits', { method: 'POST', body: { message: 'test: seed isolated catalog dependency-note repair trial', tree: tree.sha, parents: [sha] } })
  await api('/git/refs', { method: 'POST', body: { ref: `refs/heads/${TRIAL_BRANCH}`, sha: commit.sha } })
  console.log(`Created isolated trial seed ${commit.sha}; production main unchanged`)
}
