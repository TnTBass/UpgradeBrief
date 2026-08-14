import { readFile } from 'node:fs/promises'

const catalogPath = process.argv[2] ?? new URL('../src/data/catalog.snapshot.json', import.meta.url)
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))

const assert = (condition, message) => {
  if (!condition) throw new Error(`Catalog validation failed: ${message}`)
}

const sourceIds = new Set(catalog.sources.map((source) => source.id))
const releaseIds = new Set(catalog.releases.map((release) => release.id))
const productIds = new Set(catalog.products.map((product) => product.id))
const releaseById = new Map(catalog.releases.map((release) => [release.id, release]))
assert(catalog.schemaVersion === 1, 'schemaVersion must equal 1')
assert(new Date(catalog.generatedAt).toString() !== 'Invalid Date', 'generatedAt must be an ISO date')
assert(Array.isArray(catalog.securityFeedArticleIds) && catalog.securityFeedArticleIds.length > 0, 'securityFeedArticleIds must retain the discovered security feed inventory')
assert(new Set(catalog.securityFeedArticleIds).size === catalog.securityFeedArticleIds.length, 'securityFeedArticleIds must be unique')
for (const articleId of catalog.securityFeedArticleIds) assert(/^kb\d+$/.test(articleId), `security feed article ID ${articleId} must be canonical`)
assert(Array.isArray(catalog.securityFeedRoutes) && catalog.securityFeedRoutes.length === catalog.securityFeedArticleIds.length, 'securityFeedRoutes must retain one route per discovered security article')
assert(new Set(catalog.securityFeedRoutes.map((route) => route.articleId)).size === catalog.securityFeedRoutes.length, 'securityFeedRoutes article IDs must be unique')
for (const route of catalog.securityFeedRoutes) {
  assert(catalog.securityFeedArticleIds.includes(route.articleId), `security feed route ${route.articleId} must reference a discovered article`)
  assert(['parsed', 'dedicated', 'inventory', 'informational', 'out-of-scope', 'unclassified'].includes(route.classification), `security feed route ${route.articleId} has an invalid classification`)
  assert(Array.isArray(route.productIds) && route.productIds.every((productId) => productIds.has(productId)), `security feed route ${route.articleId} has an invalid product`)
  assert(typeof route.multiProduct === 'boolean', `security feed route ${route.articleId} must declare multi-product scope`)
}
assert(Array.isArray(catalog.securityFeedPageStates) && catalog.securityFeedPageStates.length >= catalog.securityFeedArticleIds.length, 'securityFeedPageStates must retain fetched article state')
assert(new Set(catalog.securityFeedPageStates.map((state) => state.articleId)).size === catalog.securityFeedPageStates.length, 'securityFeedPageStates article IDs must be unique')
const securityFeedPageStateById = new Map(catalog.securityFeedPageStates.map((state) => [state.articleId, state]))
for (const state of catalog.securityFeedPageStates) {
  assert(/^kb\d+$/.test(state.articleId), `security feed page state ${state.articleId} must be canonical`)
  assert(Array.isArray(state.productIds) && state.productIds.every((productId) => productIds.has(productId)), `security feed page state ${state.articleId} has an invalid product`)
  assert(typeof state.hasOutOfScopeProduct === 'boolean', `security feed page state ${state.articleId} must declare out-of-scope product evidence`)
  if (state.contentFingerprint !== undefined) assert(/^sha256:[a-f0-9]{64}$/.test(state.contentFingerprint), `security feed page state ${state.articleId} has an invalid content fingerprint`)
  if (state.observedCveIds !== undefined) assert(Array.isArray(state.observedCveIds) && new Set(state.observedCveIds).size === state.observedCveIds.length && state.observedCveIds.every((cve) => /^CVE-\d{4}-\d{4,}$/.test(cve)), `security feed page state ${state.articleId} has invalid observed CVEs`)
}
for (const route of catalog.securityFeedRoutes) {
  const state = securityFeedPageStateById.get(route.articleId)
  assert(state, `security feed route ${route.articleId} must retain fetched page state`)
  if (['dedicated', 'inventory', 'informational', 'out-of-scope'].includes(route.classification)) assert(state.contentFingerprint, `reviewed security feed route ${route.articleId} must retain a content fingerprint`)
  if (route.classification === 'inventory') assert(Array.isArray(state.observedCveIds), `inventory security feed route ${route.articleId} must retain observed CVEs`)
}
assert(Array.isArray(catalog.vspcKbArticleIds) && catalog.vspcKbArticleIds.length >= 69, 'vspcKbArticleIds must retain the full VSPC KB inventory')
assert(new Set(catalog.vspcKbArticleIds).size === catalog.vspcKbArticleIds.length, 'vspcKbArticleIds must be unique')
for (const articleId of catalog.vspcKbArticleIds) assert(/^kb\d+$/.test(articleId), `VSPC KB article ID ${articleId} must be canonical`)
assert(Array.isArray(catalog.vspcKbCvePageStates) && catalog.vspcKbCvePageStates.length > 0, 'vspcKbCvePageStates must retain CVE-bearing VSPC page state')
assert(new Set(catalog.vspcKbCvePageStates.map((state) => state.articleId)).size === catalog.vspcKbCvePageStates.length, 'vspcKbCvePageStates article IDs must be unique')
for (const state of catalog.vspcKbCvePageStates) {
  assert(catalog.vspcKbArticleIds.includes(state.articleId), `VSPC KB CVE page state ${state.articleId} must reference a discovered article`)
  assert(Array.isArray(state.observedCveIds) && state.observedCveIds.length > 0 && new Set(state.observedCveIds).size === state.observedCveIds.length && state.observedCveIds.every((cve) => /^CVE-\d{4}-\d{4,}$/.test(cve)), `VSPC KB CVE page state ${state.articleId} has invalid observed CVEs`)
  assert(/^sha256:[a-f0-9]{64}$/.test(state.securityFingerprint), `VSPC KB CVE page state ${state.articleId} has an invalid semantic fingerprint`)
  assert(/^sha256:[a-f0-9]{64}$/.test(state.catalogFingerprint), `VSPC KB CVE page state ${state.articleId} has an invalid catalog fingerprint`)
  if (state.parsedModelFingerprint !== undefined) assert(/^sha256:[a-f0-9]{64}$/.test(state.parsedModelFingerprint), `VSPC KB CVE page state ${state.articleId} has an invalid parsed-model fingerprint`)
}
assert(sourceIds.size === catalog.sources.length, 'source IDs must be unique')
assert(productIds.size === catalog.products.length, 'product IDs must be unique')
assert(releaseIds.size === catalog.releases.length, 'release IDs must be unique')

for (const product of catalog.products) {
  assert(releaseIds.has(product.recommendedReleaseId), `${product.id} recommended release must exist`)
  assert(releaseById.get(product.recommendedReleaseId)?.productId === product.id, `${product.id} recommended release must belong to the product`)
}

for (const collection of [catalog.releases, catalog.lifecycleNotices, catalog.upgradePaths, catalog.securityFindings]) {
  for (const record of collection) {
    for (const sourceId of record.sourceIds) assert(sourceIds.has(sourceId), `${record.id ?? record.productId} references unknown source ${sourceId}`)
  }
}

for (const release of catalog.releases) {
  assert(productIds.has(release.productId), `${release.id} references an unknown product`)
  for (const highlight of release.highlights ?? []) {
    for (const sourceId of highlight.sourceIds) assert(sourceIds.has(sourceId), `${release.id} highlight references unknown source ${sourceId}`)
  }
}

assert(Array.isArray(catalog.operationalNotices), 'operationalNotices must be an array')
for (const notice of catalog.operationalNotices) {
  assert(catalog.products.some((product) => product.id === notice.productId), `${notice.id} references an unknown product`)
  for (const releaseId of notice.affectedReleaseIds) assert(releaseIds.has(releaseId), `${notice.id} affected release must exist`)
  for (const sourceId of notice.sourceIds) assert(sourceIds.has(sourceId), `${notice.id} references unknown source ${sourceId}`)
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

const findingIds = new Set(catalog.securityFindings.map((finding) => finding.id))
assert(findingIds.size === catalog.securityFindings.length, 'security finding IDs must be unique')
const findingCoverageKeys = new Set()
for (const finding of catalog.securityFindings) {
  assert(productIds.has(finding.productId), `${finding.id} references an unknown product`)
  assert(finding.fixedReleaseId || finding.remediation, `${finding.id} must document a fixed release or remediation`)
  if (finding.fixedReleaseId) {
    assert(releaseIds.has(finding.fixedReleaseId), `${finding.id} fixed release must exist`)
    assert(releaseById.get(finding.fixedReleaseId)?.productId === finding.productId, `${finding.id} fixed release must belong to the finding product`)
  }
  for (const releaseId of finding.affectedReleaseIds) {
    assert(releaseIds.has(releaseId), `${finding.id} affected release must exist`)
    assert(releaseById.get(releaseId)?.productId === finding.productId, `${finding.id} affected release must belong to the finding product`)
  }
  assert(Array.isArray(finding.cves), `${finding.id} CVEs must be an array`)
  assert(new Set(finding.cves).size === finding.cves.length, `${finding.id} CVEs must be unique`)
  for (const cve of finding.cves) {
    assert(/^CVE-\d{4}-\d{4,}$/.test(cve), `${finding.id} has a non-canonical CVE`)
    const key = JSON.stringify([finding.productId, cve, finding.affectedReleaseIds, finding.affectedVersionPrefixes ?? [], finding.affectedBuildRanges ?? [], finding.fixedReleaseId, finding.remediation])
    assert(!findingCoverageKeys.has(key), `${finding.productId} has duplicate scoped coverage for ${cve}`)
    findingCoverageKeys.add(key)
  }
  if (finding.cvssScore !== undefined) assert(Number.isFinite(finding.cvssScore) && finding.cvssScore >= 0 && finding.cvssScore <= 10, `${finding.id} CVSS score must be between 0 and 10`)
  for (const range of finding.affectedBuildRanges ?? []) {
    assert(/^\d+(?:\.\d+)*\.?$/.test(range.versionPrefix), `${finding.id} has an invalid affected build prefix`)
    assert(/^\d+(?:\.\d+)+$/.test(range.throughBuild), `${finding.id} has an invalid affected through-build`)
  }
}

console.log(`Catalog valid: ${catalog.products.length} products, ${catalog.releases.length} releases, ${catalog.securityFindings.length} security findings, ${catalog.capabilities.length} capabilities.`)
