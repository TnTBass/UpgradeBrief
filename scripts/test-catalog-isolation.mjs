import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assembleCatalog, BASE_TRANSACTIONS, PRODUCT_IDS, createObservationCollector, hash, productPartition, transactionClosure, validateCatalogProvenance, validateProductHealth } from './lib/catalog-provenance.mjs'
import { runTransactions, validateGlobalDatasets } from './lib/catalog-refresh-isolation.mjs'
import { combinedCatalogFreshness } from './lib/catalog-health.mjs'
import { projectRepairState, scopedRevert } from './lib/catalog-repair-feedback.mjs'
import { verifyPublication } from './lib/catalog-repair-verification.mjs'

const original = JSON.parse(await readFile(new URL('../src/data/catalog.snapshot.json', import.meta.url), 'utf8'))
// Migration is exercised independently of the on-disk schema.
const legacy = structuredClone(original)
legacy.schemaVersion = 1
for (const key of ['sourceOwnership', 'productValidation', 'sourceObservations', 'sourceRevisions', 'refreshPolicyHash', 'assembledAt']) delete legacy[key]
const baselines = JSON.parse(await readFile(new URL('./data/security-review-baselines.json', import.meta.url), 'utf8'))
const start = '2026-10-27T01:00:00.000Z'
const nextTime = '2026-10-30T18:00:00.000Z'
const policyHash = hash('fixture-parser-policy')
const collector = () => ({ observations: new Map(), usage: new Map(), forProducts: () => ({ request: () => { throw new Error('Unexpected network') } }) })
function candidate(current, productIds, marker = '') {
  const catalog = structuredClone(current)
  catalog.securityFeedPageStates.sort((a,b) => a.articleId.localeCompare(b.articleId))
  for (const product of catalog.products) if (productIds.includes(product.id)) product.aliases.push('fixture-' + marker)
  return { catalog, baselines, equivalentChanges: [], inventoryChanges: [] }
}
const initial = assembleCatalog({
  current: legacy, baselines, outcomes: BASE_TRANSACTIONS.map(productIds => ({ productIds, result: candidate(legacy, productIds, 'initial') })),
  ...collector(), policyHash, assembledAt: start,
}).catalog
assert.equal(validateCatalogProvenance(initial), true)
assert.equal(initial.generatedAt, start)
const supplementalRollback = projectRepairState({ catalog: initial, baselines, reviewedData: { advisories: [], observationSpecs: {} } }, ['kb4857'])
assert.deepEqual(supplementalRollback.productRollback.productIds, ['veeam-one', 'vro'])
assert.ok(supplementalRollback.productRollback.pageStates.some(state => state.articleId === 'kb4857'))
assert.ok(supplementalRollback.productRollback.baselines.kb4857)

const partial = await runTransactions({
  current: initial, baselines, collector: collector(), policyHash, groups: BASE_TRANSACTIONS, shadow: false, now: () => nextTime,
  build: async ({ current, productIds }) => {
    if (productIds.includes('vb365')) throw Object.assign(new Error('injected VB365 parser failure'), { code: 'BUILD_PARSER_INCOMPLETE' })
    return candidate(current, productIds, 'advance')
  },
})
assert.equal(partial.report.status, 'partial')
assert.deepEqual(productPartition(partial.catalog, 'vb365'), productPartition(initial, 'vb365'))
const retained = partial.catalog.productValidation.find(item => item.productId === 'vb365')
assert.equal(retained.validatedAt, start)
assert.equal(retained.state, 'retained')
assert.equal(retained.partitionHash, initial.productValidation.find(item => item.productId === 'vb365').partitionHash)
assert.deepEqual(retained.evidenceIds, initial.productValidation.find(item => item.productId === 'vb365').evidenceIds)
assert.equal(partial.catalog.productValidation.find(item => item.productId === 'vbr').validatedAt, nextTime)
assert.equal(partial.catalog.generatedAt, start)
assert.deepEqual(partial.baselines, baselines)
assert.equal(validateCatalogProvenance(partial.catalog), true)

const publicHealth = { schemaVersion: 2, commit: 'a'.repeat(40), catalogHash: hash(partial.catalog), generatedAt: partial.catalog.generatedAt, assembledAt: nextTime, productValidation: partial.catalog.productValidation }
assert.equal(combinedCatalogFreshness(partial.catalog, publicHealth, Date.parse(nextTime)).level, 'critical')
assert.equal(combinedCatalogFreshness(partial.catalog, { ...publicHealth, productValidation: [] }, Date.parse(nextTime)).deployment.reason, 'invalid-product-health')
assert.equal(combinedCatalogFreshness(partial.catalog, null, Date.parse(nextTime)).level, 'critical')
assert.equal(combinedCatalogFreshness(partial.catalog, publicHealth, Date.parse(nextTime), { commit: 'b'.repeat(40) }).deployment.reason, 'published-health-unavailable')
const recovered = await runTransactions({ current: partial.catalog, baselines, collector: collector(), policyHash, groups: BASE_TRANSACTIONS, shadow: false, now: () => nextTime, build: async ({ current, productIds }) => candidate(current, productIds, 'recovery') })
assert.equal(recovered.report.status, 'complete')
assert.equal(recovered.catalog.generatedAt, nextTime)
assert.ok(recovered.catalog.productValidation.every(item => item.state === 'validated' && item.failureCodes.length === 0))
const freshPartial = structuredClone(partial.catalog)
freshPartial.generatedAt = nextTime
for (const item of freshPartial.productValidation) item.validatedAt = nextTime
assert.equal(combinedCatalogFreshness(freshPartial, { ...publicHealth, generatedAt: nextTime, productValidation: freshPartial.productValidation }, Date.parse(nextTime)).level, 'warning')

const allFailed = { current: initial, baselines, collector: collector(), policyHash, groups: BASE_TRANSACTIONS, shadow: false, now: () => nextTime, build: async () => { throw new Error('failed') } }
await assert.rejects(runTransactions(allFailed), /ALL_TRANSACTIONS_BLOCKED/)
await assert.rejects(runTransactions({ ...allFailed, atomic: true }), /ATOMIC_REFRESH_BLOCKED/)
await assert.rejects(runTransactions({ ...allFailed, build: async () => { throw Object.assign(new Error('unknown scope'), { code: 'UNKNOWN_SOURCE_OWNERSHIP' }) } }), /unknown scope/)
await assert.rejects(runTransactions({ ...allFailed, reviewTexts: { kb3103: baselines.articles.kb3103.normalizedText + ' CVE-2099-99999' } }), /UNCLASSIFIED_NEW_CVE/)
assert.throws(() => assembleCatalog({ current: legacy, baselines, outcomes: [{ productIds: ['vb365'], failureCodes: ['FAIL'] }, ...BASE_TRANSACTIONS.slice(0,3).map(productIds => ({ productIds, result: candidate(legacy, productIds) }))], ...collector(), policyHash, assembledAt: nextTime }), /SCHEMA_MIGRATION/)

assert.ok(transactionClosure([['vbr', 'enterprise-manager']]).some(group => group.includes('vbr') && group.includes('enterprise-manager')))
assert.ok(transactionClosure([['vbr', 'veeam-one', 'vspc']]).some(group => group.length === 5))
assert.ok(transactionClosure([]).some(group => group.length === 2 && group.includes('veeam-one') && group.includes('vro')))
assert.deepEqual(transactionClosure([PRODUCT_IDS]), [[...PRODUCT_IDS].sort()])
assert.throws(() => transactionClosure([['unknown']]), /UNKNOWN_SOURCE_OWNERSHIP/)
for (const mutate of [
  c => c.productValidation.pop(),
  c => c.productValidation[0].validatedAt = 'invalid',
  c => c.productValidation[0].attemptedAt = '2099-01-01',
  c => c.productValidation[0].state = 'unknown',
  c => c.productValidation[0].evidenceIds = ['unresolved'],
  c => c.products[0].recommendedReleaseId = 'unvalidated-release',
  c => c.generatedAt = nextTime,
  c => c.sourceRevisions[0].digest = 'b'.repeat(64),
  c => delete c.sourceOwnership.kb2680,
  c => c.sourceOwnership.kb2680 = ['unknown'],
  c => c.sources.find(source => source.id === 'kb2680').url = 'https://example.test/incorrect-source',
]) {
  const broken = structuredClone(initial); mutate(broken)
  assert.throws(() => validateCatalogProvenance(broken))
}
assert.throws(() => validateProductHealth({ ...publicHealth, productValidation: publicHealth.productValidation.slice(1) }))

const lifecycleNames = ['Veeam Backup & Replication', 'Veeam ONE', 'Veeam Recovery Orchestrator', 'Veeam Service Provider Console', 'Veeam Backup for Microsoft 365']
const lifecycleHtml = lifecycleNames.flatMap(name => [12,13].map(version => '<tr><td>'+name+'</td><td>'+version+'</td><td>January 2025</td><td>November 2028</td><td>November 2028</td></tr>')).join('')
const globalBase = { securityFindings: [{ isCisaKev: true, cves: ['CVE-2024-40711'] }] }
const kevJson = JSON.stringify({ count: 1, vulnerabilities: [{ cveID: 'CVE-2024-40711' }] })
assert.doesNotThrow(() => validateGlobalDatasets(globalBase, kevJson, lifecycleHtml))
assert.throws(() => validateGlobalDatasets(globalBase, JSON.stringify({ count: 0, vulnerabilities: [] }), lifecycleHtml), /KEV_INVENTORY_INCOMPLETE/)
assert.throws(() => validateGlobalDatasets(globalBase, JSON.stringify({ count: 10, vulnerabilities: [{ cveID: 'CVE-2024-40711' }] }), lifecycleHtml), /KEV_INVENTORY_INCOMPLETE/)
assert.throws(() => validateGlobalDatasets(globalBase, kevJson.replace('40711','99999'), lifecycleHtml), /KEV_COVERAGE_REMOVED/)
assert.throws(() => validateGlobalDatasets(globalBase, kevJson, lifecycleHtml.replaceAll('Veeam ONE','Veeam Backup & Replication')), /LIFECYCLE_INCOMPLETE/)
for (const [edges, failedProduct, retainedProducts] of [
  [[], 'veeam-one', ['veeam-one','vro']],
  [[['vbr','enterprise-manager']], 'enterprise-manager', ['enterprise-manager','vbr']],
  [[['vbr','veeam-one','vspc']], 'vspc', ['enterprise-manager','vbr','veeam-one','vro','vspc']],
]) {
  const coupled = await runTransactions({ current: initial, baselines, collector: collector(), policyHash, groups: transactionClosure(edges), shadow: false, now: () => nextTime, build: async ({ current, productIds }) => {
    if (productIds.includes(failedProduct)) { current.releases.push({ id: 'unvalidated-new-release', productId: failedProduct }); throw new Error('CVE applicability failed after build discovery') }
    return candidate(current, productIds, 'coupled')
  } })
  assert.deepEqual(coupled.catalog.productValidation.filter(item => item.state === 'retained').map(item => item.productId).sort(), retainedProducts.sort())
  assert.ok(!coupled.catalog.releases.some(item => item.id === 'unvalidated-new-release'))
  for (const id of retainedProducts) assert.deepEqual(productPartition(coupled.catalog,id), productPartition(initial,id))
}
const reviewedData = JSON.parse(await readFile(new URL('./data/reviewed-security-advisories.json', import.meta.url),'utf8'))
const beforeRepair = { catalog: initial, baselines, reviewedData }
const afterRepair = { catalog: recovered.catalog, baselines, reviewedData }
const oldState = projectRepairState(beforeRepair, ['kb4106'])
const repairedState = projectRepairState(afterRepair, ['kb4106'])
const rollback = scopedRevert({ current: afterRepair, before: oldState, after: repairedState, articleIds: ['kb4106'] })
assert.deepEqual(productPartition(rollback.catalog, 'vb365'), productPartition(initial, 'vb365'))
assert.deepEqual(productPartition(rollback.catalog, 'vbr'), productPartition(recovered.catalog, 'vbr'))
assert.equal(rollback.catalog.productValidation.find(item => item.productId === 'vb365').validatedAt, start)
assert.equal(rollback.catalog.productValidation.find(item => item.productId === 'vb365').state, 'retained')
const overlapping = structuredClone(afterRepair)
overlapping.catalog.products.find(item => item.id === 'vb365').aliases.push('later product change')
assert.throws(() => scopedRevert({ current: overlapping, before: oldState, after: repairedState, articleIds: ['kb4106'] }), /overlap/)
let calls = 0
const cached = createObservationCollector({ request: async () => { calls++; return new Response('immutable evidence', { headers: { 'content-type': 'text/plain' } }) } })
const first = await cached.forProducts(['vbr']).request('https://example.test/source', { sourceId: 'source' })
const second = await cached.forProducts(['vb365']).request('https://example.test/source', { sourceId: 'alias' })
assert.equal(await first.text(), 'immutable evidence')
assert.equal(await second.text(), 'immutable evidence')
assert.equal(calls, 1)
assert.deepEqual([...cached.usage.values()][0], new Set(['vbr', 'vb365']))
let failedCalls = 0
const failed = createObservationCollector({ request: async () => { failedCalls++; throw new Error('unavailable') } })
await assert.rejects(failed.forProducts(['vb365']).request('https://example.test/fail'))
await assert.rejects(failed.forProducts(['vbr']).request('https://example.test/fail'))
assert.equal(failedCalls, 1)
await assert.rejects(verifyPublication({ commit: 'a'.repeat(40), catalogHash: hash(partial.catalog), attempts: 1, fetchImpl: async () => new Response(JSON.stringify({ ...publicHealth, productValidation: [] })) }), /could not be verified/)
assert.equal((await verifyPublication({ commit: 'a'.repeat(40), catalogHash: hash(partial.catalog), attempts: 1, fetchImpl: async () => new Response(JSON.stringify(publicHealth)) })).commit, publicHealth.commit)
console.log('Catalog isolation: migration, whole-partition retention, freshness, recovery, shared ownership, malformed provenance, response caching and publication checks passed.')

