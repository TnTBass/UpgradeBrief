import { readFile } from 'node:fs/promises'
import { catalogFreshness } from './lib/catalog-health.mjs'
import { repairHash } from './lib/catalog-repair-evidence.mjs'
import { githubClient } from './lib/catalog-repair-state.mjs'
import { ensureLabels, ensureInvestigation, findRepairIssue, notifyOnce } from './lib/catalog-repair-publication.mjs'

const catalog = JSON.parse(await readFile('src/data/catalog.snapshot.json', 'utf8'))
const health = catalogFreshness(catalog.generatedAt)
console.log(JSON.stringify({ generatedAt: catalog.generatedAt, ...health }))
const api = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN })
const id = repairHash({ kind: 'catalog-freshness-monitor', version: 1 })
const previous = await findRepairIssue(api, id)
if (health.level === 'healthy') {
  if (previous?.state === 'open') await api(`/issues/${previous.number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } })
} else {
  await ensureLabels(api)
  const body = `<!-- catalog-repair:${id} -->\nCatalog freshness: **${health.level}**. Last validated snapshot: ${catalog.generatedAt}. Age: ${health.ageHours?.toFixed(1) ?? 'unknown'} hours.\n\nWarnings begin at 36 hours; critical escalation begins at 72 hours. Repair workflow success does not reset this clock. Inspect the latest Refresh catalog and Catalog repair runs. This issue closes automatically after a fresh snapshot reaches main.`
  const issue = await ensureInvestigation(api, { id, title: `Catalog freshness: ${health.level}`, body })
  await api(`/issues/${issue.number}`, { method: 'PATCH', body: { title: `Catalog freshness: ${health.level}`, body, state: 'open' } })
  await notifyOnce(api, issue.number, `${id}:${catalog.generatedAt}:${health.level}`, `The catalog is ${health.level === 'critical' ? 'critically stale (72+ hours)' : 'stale (36+ hours)'}. Last validated snapshot: ${catalog.generatedAt}. Check the linked investigation.`)
}
