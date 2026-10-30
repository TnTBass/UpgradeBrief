import { readFile } from 'node:fs/promises'
import { combinedCatalogFreshness } from './lib/catalog-health.mjs'
import { repairHash } from './lib/catalog-repair-evidence.mjs'
import { githubClient } from './lib/catalog-repair-state.mjs'
import { ensureLabels, ensureInvestigation, findRepairIssue, notifyOnce } from './lib/catalog-repair-publication.mjs'

const catalog = JSON.parse(await readFile('src/data/catalog.snapshot.json', 'utf8'))
let published
for (let attempt = 0; attempt < 2 && !published; attempt++) {
  try {
    const response = await fetch('https://upgradebrief.com/catalog-health.json', { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000), redirect: 'error' })
    if (response.ok) published = await response.json()
  } catch { /* Report the missing publication health after bounded retries. */ }
}
const health = combinedCatalogFreshness(catalog, published)
console.log(JSON.stringify({ generatedAt: catalog.generatedAt, publishedAt: published?.generatedAt, ...health }))
const api = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN })
const id = repairHash({ kind: 'catalog-freshness-monitor', version: 1 })
const previous = await findRepairIssue(api, id)
const productDetails = [ ['Main', health.repository], ['Published', health.deployment] ].flatMap(([label, state]) => (state.products ?? []).map(item => label + ': ' + item.productId + ' — ' + item.level + ', ' + item.state + ', validated ' + item.validatedAt + (item.failureCodes.length ? '; ' + item.failureCodes.join(', ') : ''))).join('\n\n')
const productFailureIdentity = repairHash([health.repository.products, health.deployment.products].map(items => items?.map(({ productId, validatedAt, state, failureCodes }) => ({ productId, validatedAt, state, failureCodes }))))
if (health.level === 'healthy') {
  if (previous?.state === 'open') await api(`/issues/${previous.number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } })
} else {
  await ensureLabels(api)
  const body = `<!-- catalog-repair:${id} -->\nCatalog freshness: **${health.level}**. Last validated snapshot on main: ${catalog.generatedAt} (${health.repository.ageHours?.toFixed(1) ?? 'unknown'} hours). Published snapshot: ${published?.generatedAt ?? 'unavailable'} (${health.deployment.ageHours?.toFixed(1) ?? 'unknown'} hours; ${health.deployment.reason}).\n\n${productDetails}\n\nRetained product data warns immediately. Warnings begin at 36 hours; critical escalation begins at 72 hours. Missing or invalid published health is also critical. Repair workflow success does not reset this clock. Inspect the latest Refresh catalog, Catalog repair, and deployment runs. This issue closes automatically after both main and the published catalog are fresh.`
  const issue = await ensureInvestigation(api, { id, title: `Catalog freshness: ${health.level}`, body })
  await api(`/issues/${issue.number}`, { method: 'PATCH', body: { title: `Catalog freshness: ${health.level}`, body, state: 'open' } })
  await notifyOnce(api, issue.number, `${id}:${catalog.generatedAt}:${published?.generatedAt ?? 'unavailable'}:${health.level}:${productFailureIdentity}`, `Catalog freshness requires attention (${health.level}). Last validated snapshot on main: ${catalog.generatedAt}. Published health: ${health.deployment.reason}. Check the investigation for age and deployment details.`)
}
