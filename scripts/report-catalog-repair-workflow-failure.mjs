import { githubClient, githubStateStore } from './lib/catalog-repair-state.mjs'
import { ensureLabels, ensureInvestigation, notifyOnce } from './lib/catalog-repair-publication.mjs'
import { repairHash } from './lib/catalog-repair-evidence.mjs'
const api = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN })
const runId = process.env.GITHUB_RUN_ID
if (!/^\d+$/.test(runId ?? '')) throw new Error('Missing workflow identity')
const jobs = await api(`/actions/runs/${runId}/jobs?per_page=100`)
const failed = jobs.jobs.flatMap(job => job.steps.filter(step => step.conclusion === 'failure').map(step => step.name)).sort()
const id = repairHash({ kind: 'repair-workflow-failure', failed })
await ensureLabels(api)
const issue = await ensureInvestigation(api, { id, title: 'Catalog repair automation needs attention', body: `<!-- catalog-repair:${id} -->\nThe repair workflow stopped before completing its report. Failed steps: ${failed.join(', ') || 'unknown'}.\n\n[Inspect the failed run](https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}). No successful repair or publication is implied. Repeated identical failures reuse this issue.` })
const key = `${id}:workflow-failure`, message = `Catalog repair automation needs attention. [The investigation](https://github.com/${process.env.GITHUB_REPOSITORY}/issues/${issue.number}) links the failed step and run.`
const store = githubStateStore(api)
let state
try {
  state = await store.load()
  state.repairs[id] ??= { state: 'needs-investigation', environment: 'production', number: issue.number, articleIds: [] }
  state.repairs[id].notification = { pending: true, key, message }
  await store.save(state)
} catch { console.log('Durable state is unavailable; the investigation issue still records the failure.') }
const notification = await notifyOnce(api, issue.number, key, message)
if (state) {
  state.repairs[id].notification = { ...notification, pending: false, key, message }
  await store.save(state)
}
