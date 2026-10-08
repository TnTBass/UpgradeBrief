import { execFileSync } from 'node:child_process'
import { githubClient } from './lib/catalog-repair-state.mjs'
import { assertCandidateScope, repairBaseBranch, REPAIR_DATA_PATHS } from './lib/catalog-repair-publication.mjs'

const sha = process.env.REPAIR_COMMIT, baseCommit = process.env.REPAIR_BASE, id = process.env.REPAIR_ID
if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !/^[a-f0-9]{40}$/.test(baseCommit ?? '') || !/^sha256:[a-f0-9]{64}$/.test(id ?? '')) throw new Error('Invalid exact verification identity')
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const environment = process.env.REPAIR_ENVIRONMENT ?? 'production'
const baseBranch = repairBaseBranch(environment)
const api = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN })
if (process.argv.includes('--record')) {
  const success = head === sha && process.env.VERIFICATION_OUTCOME === 'success'
  await api('/check-runs', { method: 'POST', body: {
    name: 'Catalog repair verified', head_sha: sha, status: 'completed', conclusion: success ? 'success' : 'failure',
    details_url: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    output: { title: success ? 'Exact candidate passed all catalog checks' : 'Candidate verification did not pass', summary: `Candidate ${sha}; trusted base ${baseCommit}; repair ${id}.` },
  } })
  if (!success) process.exitCode = 1
} else {
  // Never execute candidate code based on an attacker-selected historical base.
  // The first checkout is the dispatch workflow's trusted main commit.
  if ((await api('/git/ref/heads/main')).object.sha !== head) throw new Error('Verification code is not current trusted main')
  if ((await api(`/git/ref/heads/${baseBranch}`)).object.sha !== baseCommit) throw new Error('Verification base branch changed')
  if (environment === 'production' && head !== baseCommit) throw new Error('Verification base is not current trusted main')
  if (environment === 'trial') {
    const comparison = await api(`/compare/${head}...${baseCommit}`)
    if (!['ahead', 'identical'].includes(comparison.status) || comparison.files.length > 20 || comparison.files.some(file => !REPAIR_DATA_PATHS.includes(file.filename) && !/^docs\/catalog-repairs\/[a-f0-9]{64}\.json$/.test(file.filename))) throw new Error('Trial base contains code changes or does not include current main')
  }
  await assertCandidateScope(api, { sha, baseCommit, id })
  console.log(`Verified data-only candidate scope at ${sha}`)
}
