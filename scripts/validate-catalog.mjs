import { readFile } from 'node:fs/promises'

const catalogPath = process.argv[2] ?? new URL('../src/data/catalog.snapshot.json', import.meta.url)
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))

const assert = (condition, message) => {
  if (!condition) throw new Error(`Catalog validation failed: ${message}`)
}

const sourceIds = new Set(catalog.sources.map((source) => source.id))
const releaseIds = new Set(catalog.releases.map((release) => release.id))
assert(catalog.schemaVersion === 1, 'schemaVersion must equal 1')
assert(new Date(catalog.generatedAt).toString() !== 'Invalid Date', 'generatedAt must be an ISO date')
assert(releaseIds.size === catalog.releases.length, 'release IDs must be unique')

for (const product of catalog.products) {
  assert(releaseIds.has(product.recommendedReleaseId), `${product.id} recommended release must exist`)
}

for (const collection of [catalog.releases, catalog.lifecycleNotices, catalog.upgradePaths, catalog.securityFindings]) {
  for (const record of collection) {
    for (const sourceId of record.sourceIds) assert(sourceIds.has(sourceId), `${record.id ?? record.productId} references unknown source ${sourceId}`)
  }
}

for (const release of catalog.releases) {
  for (const highlight of release.highlights ?? []) {
    for (const sourceId of highlight.sourceIds) assert(sourceIds.has(sourceId), `${release.id} highlight references unknown source ${sourceId}`)
  }
}

assert(Array.isArray(catalog.capabilities), 'capabilities must be an array')
for (const capability of catalog.capabilities) {
  assert(catalog.products.some((product) => product.id === capability.productId), `${capability.id} references an unknown product`)
  assert(/^\d+(?:\.\d+)*$/.test(capability.introducedIn), `${capability.id} must have a numeric introducedIn version`)
  assert(Number.isFinite(capability.priority), `${capability.id} must have a numeric priority`)
  for (const sourceId of capability.sourceIds) assert(sourceIds.has(sourceId), `${capability.id} references unknown source ${sourceId}`)
}

assert(Array.isArray(catalog.releaseImprovements), 'releaseImprovements must be an array')
for (const improvement of catalog.releaseImprovements) {
  assert(catalog.products.some((product) => product.id === improvement.productId), `${improvement.id} references an unknown product`)
  assert(releaseIds.has(improvement.targetReleaseId), `${improvement.id} references an unknown target release`)
  assert(Array.isArray(improvement.topics) && improvement.topics.length > 0, `${improvement.id} must include at least one documented topic`)
  for (const sourceId of improvement.sourceIds) assert(sourceIds.has(sourceId), `${improvement.id} references unknown source ${sourceId}`)
}

for (const source of catalog.sources) {
  if (source.releaseFamily !== undefined) assert(/^\d+\.\d+$/.test(source.releaseFamily), `${source.id} has an invalid releaseFamily`)
  if (source.materialKind !== undefined) assert(['release-notes', 'whats-new'].includes(source.materialKind), `${source.id} has an invalid materialKind`)
  if (source.contentHash !== undefined) assert(/^[a-f0-9]{64}$/.test(source.contentHash), `${source.id} has an invalid contentHash`)
}

for (const path of catalog.upgradePaths) {
  assert(releaseIds.has(path.fromReleaseId) && releaseIds.has(path.toReleaseId), `${path.id} references an unknown endpoint`)
  assert(!path.hopReleaseIds.includes(path.fromReleaseId), `${path.id} includes a route cycle`)
  for (const releaseId of path.hopReleaseIds) assert(releaseIds.has(releaseId), `${path.id} references unknown hop ${releaseId}`)
  for (const alternative of path.alternatives ?? []) {
    assert(releaseIds.has(alternative.releaseId), `${path.id} references unknown alternative ${alternative.releaseId}`)
    for (const sourceId of alternative.sourceIds) assert(sourceIds.has(sourceId), `${path.id} alternative references unknown source ${sourceId}`)
  }
}

for (const finding of catalog.securityFindings) {
  assert(releaseIds.has(finding.fixedReleaseId), `${finding.id} fixed release must exist`)
  for (const releaseId of finding.affectedReleaseIds) assert(releaseIds.has(releaseId), `${finding.id} affected release must exist`)
}

console.log(`Catalog valid: ${catalog.products.length} products, ${catalog.releases.length} releases, ${catalog.securityFindings.length} security findings, ${catalog.capabilities.length} capabilities.`)
