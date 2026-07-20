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

console.log(`Catalog valid: ${catalog.products.length} products, ${catalog.releases.length} releases, ${catalog.securityFindings.length} security findings.`)
