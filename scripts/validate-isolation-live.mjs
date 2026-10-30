import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { buildCatalogCandidate } from './catalog-refresh-candidate.mjs'
import { refreshPolicyHash, discoverTransactions, runTransactions } from './lib/catalog-refresh-isolation.mjs'
import { createCatalogSourceFetcher } from './lib/source-fetch.mjs'
import { createObservationCollector, productPartition } from './lib/catalog-provenance.mjs'
const current = JSON.parse(await readFile('src/data/catalog.snapshot.json','utf8'))
const baselines = JSON.parse(await readFile('scripts/data/security-review-baselines.json','utf8'))
const collector = createObservationCollector(createCatalogSourceFetcher())
const policyHash = await refreshPolicyHash()
const reviewTexts = {}
const groups = await discoverTransactions({ current, baselines, collector, policyHash, reviewTexts })
console.log(JSON.stringify({ groups, stage: 'discovery-complete' }))
const result = await runTransactions({ current, baselines, collector, policyHash, groups, reviewTexts })
assert.equal(result.report.status, 'complete')
assert.equal(result.report.shadowCompared, true)
const newGroups = await discoverTransactions({ current: result.catalog, baselines: result.baselines, collector, policyHash, reviewTexts: {} })
console.log(JSON.stringify({ groups: newGroups, stage: 'fault-injection-groups' }))
const partial = await runTransactions({
  current: result.catalog, baselines: result.baselines, collector, policyHash, groups: newGroups,
  build: async args => buildCatalogCandidate({ ...args, sourceFetcher: { request: async (url, options) => {
    if (options?.sourceId === 'kb4106') return new Response('<html>Incomplete vendor build list</html>')
    return args.sourceFetcher.request(url, options)
  } } }),
})
assert.equal(partial.report.status, 'partial')
assert.deepEqual(partial.catalog.productValidation.filter(item => item.state === 'retained').map(item => item.productId), ['vb365'])
assert.deepEqual(productPartition(partial.catalog,'vb365'), productPartition(result.catalog,'vb365'))
await mkdir('artifacts/catalog-isolation', { recursive: true })
await writeFile('artifacts/catalog-isolation/partial-fixture.json', JSON.stringify(partial.catalog,null,2)+'\n')
execFileSync(process.execPath, ['scripts/validate-catalog.mjs','artifacts/catalog-isolation/partial-fixture.json'], { stdio: 'inherit' })
await writeFile('src/data/catalog.snapshot.json',JSON.stringify(result.catalog,null,2)+'\n')
await writeFile('scripts/data/security-review-baselines.json',JSON.stringify(result.baselines,null,2)+'\n')
await writeFile('artifacts/catalog-isolation/live-report.json',JSON.stringify({ complete:result.report, partial:partial.report },null,2)+'\n')
console.log(JSON.stringify({ complete:result.report, partial:partial.report }))

