import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extractWithWorkersAi } from './lib/catalog-repair-ai.mjs'
import { githubClient, githubStateStore } from './lib/catalog-repair-state.mjs'
import { inspectSemanticChange, applySemanticChange } from './lib/catalog-repair-semantics.mjs'

if (process.env.CATALOG_REPAIR_ALLOW_LIVE !== 'true') throw new Error('Live benchmark requires explicit workflow input')
const fixture = JSON.parse(await readFile('scripts/fixtures/catalog-repair/supported-semantics.json', 'utf8'))
const article = { articleId: 'kb4934', ...fixture.vulnerability }
const policy = { advisories: [{ articleId: 'kb4934', productId: 'vbr', records: [{ cve: 'CVE-2025-64393', title: 'Reviewed anchor', cvssScore: 9.4 }], affectedBuildRanges: [{ versionPrefix: '12.', throughBuild: '12.3.2.4854' }], fixedReleaseId: 'vbr-build-12-3-2-4934' }], observationSpecs: { kb4934: { classification: 'dedicated', productCves: { vbr: ['CVE-2025-64393'] } } } }
const supported = inspectSemanticChange(article, policy)
const store = githubStateStore(githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN }))
const started = Date.now()
const response = await extractWithWorkersAi({ excerpt: supported.excerpt, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_WORKERS_AI_TOKEN, cacheKey: { fixture: 'supported-semantics-v1', validator: '2-supported-semantics' }, loadState: store.load, saveState: store.save })
const accepted = Boolean(applySemanticChange({ article, reviewedData: policy, extraction: response.extraction }))
const expected = supported.records.map(record => ({ cve: record.cve, product: record.product, description: record.description, affected: record.affected, fixed: record.fixed, conditions: record.conditions, severity: record.severity, mitigation: '' }))
const evidenceFieldMatches = expected.map(record => {
  const actual = response.extraction.records.find(item => item.cve === record.cve)
  return { cve: record.cve, fields: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, actual?.[key] === value])) }
})
const result = { schemaVersion: 1, fixture: 'source-derived reconstructed addition; not a historical acceptance claim', model: response.model, cached: response.cached, durationMs: Date.now() - started, usage: response.usage, accepted, evidenceFieldMatches, missingCves: expected.filter(record => !response.extraction.records.some(item => item.cve === record.cve)).map(record => record.cve), unresolvedCount: response.extraction.unresolved.length, extraction: response.extraction }
await mkdir('artifacts/catalog-repair/benchmark', { recursive: true })
await writeFile('artifacts/catalog-repair/benchmark/result.json', `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ accepted, model: result.model, cached: result.cached, durationMs: result.durationMs, usage: result.usage }))
if (!accepted) throw new Error('Live extraction did not satisfy the maintained semantic validator')
