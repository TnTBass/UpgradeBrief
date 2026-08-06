import assert from 'node:assert/strict'
import {
  SecurityFeedCoverageError,
  assertSecurityFeedContinuity,
  assertSecurityFeedCoverage,
  assertSecurityFeedPageStateContinuity,
  assertSecurityFeedRouteContinuity,
  buildSecurityArticleClassifications,
  classifySecurityFeedArticles,
  createSecurityFeedCoverageReport,
  extractCveIds,
  extractSecurityArticleScope,
  fetchSecurityFeedPages,
  fingerprintSecurityArticleContent,
  inferSecurityArticleProducts,
  inspectSecurityFeedCoverage,
} from './lib/security-feed-coverage.mjs'

function article(id, products = [], seoTitle = '') {
  return {
    id,
    type: 'security',
    url: `/${id}`,
    seoTitle,
    product: products.map((title) => ({ title })),
  }
}

function catalogFinding(articleId, productId, cves) {
  return { productId, cves, sourceIds: [articleId] }
}

function findingCodes(report) {
  return report.findings.map((finding) => finding.code)
}

const pagedArticles = [
  article('kb1001', ['Veeam Backup & Replication']),
  article('kb1002', ['Veeam ONE']),
  article('kb1003', ['Veeam Service Provider Console']),
  article('kb1004', ['Veeam Recovery Orchestrator']),
  article('kb1005', ['Veeam Backup for Microsoft 365']),
]
const requestedOffsets = []
const pagedFeed = await fetchSecurityFeedPages({
  pageSize: 2,
  fetchPage: ({ offset, limit }) => {
    requestedOffsets.push(offset)
    return JSON.stringify({ totalSize: pagedArticles.length, articles: pagedArticles.slice(offset, offset + limit) })
  },
})
assert.equal(pagedFeed.totalSize, 5)
assert.equal(pagedFeed.pageCount, 3)
assert.deepEqual(requestedOffsets, [0, 2, 4])
assert.deepEqual(pagedFeed.articles.map(({ id }) => id), ['kb1001', 'kb1002', 'kb1003', 'kb1004', 'kb1005'])
assert.deepEqual(assertSecurityFeedContinuity(undefined, pagedFeed.articles), ['kb1001', 'kb1002', 'kb1003', 'kb1004', 'kb1005'])
assert.throws(
  () => assertSecurityFeedContinuity(['kb1001', 'kb1002'], [pagedFeed.articles[1]]),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'FEED_ARTICLE_DISAPPEARED' && error.report.findings[0].articleId === 'kb1001',
)
const initialRoutes = assertSecurityFeedRouteContinuity(undefined, [
  { articleId: 'kb1001', classification: 'parsed', productIds: ['vbr'], multiProduct: false },
])
assert.deepEqual(initialRoutes, [{ articleId: 'kb1001', classification: 'parsed', productIds: ['vbr'], multiProduct: false }])
assert.throws(
  () => assertSecurityFeedRouteContinuity(initialRoutes, [
    { articleId: 'kb1001', classification: 'out-of-scope', productIds: [], multiProduct: false },
  ]),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'FEED_ARTICLE_ROUTE_CHANGED',
)
const initialPageStates = assertSecurityFeedPageStateContinuity(undefined, [
  { articleId: 'kb1001', productIds: ['vbr'], hasOutOfScopeProduct: false, contentFingerprint: `sha256:${'a'.repeat(64)}` },
])
assert.throws(
  () => assertSecurityFeedPageStateContinuity(initialPageStates, [
    { articleId: 'kb1001', productIds: ['vbr'], hasOutOfScopeProduct: false, contentFingerprint: `sha256:${'b'.repeat(64)}` },
  ]),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'REVIEWED_ARTICLE_CONTENT_CHANGED',
)
assert.throws(
  () => assertSecurityFeedPageStateContinuity(initialPageStates, [
    { articleId: 'kb1001', productIds: ['vbr', 'vspc'], hasOutOfScopeProduct: false, contentFingerprint: `sha256:${'a'.repeat(64)}` },
  ]),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'ARTICLE_PRODUCT_SCOPE_CHANGED',
)
const inventoryPageStates = assertSecurityFeedPageStateContinuity(undefined, [
  { articleId: 'kb1002', productIds: ['veeam-one'], hasOutOfScopeProduct: false, contentFingerprint: `sha256:${'a'.repeat(64)}`, observedCveIds: ['CVE-2026-10001'] },
])
assert.throws(
  () => assertSecurityFeedPageStateContinuity(inventoryPageStates, [
    { articleId: 'kb1002', productIds: ['veeam-one'], hasOutOfScopeProduct: false, contentFingerprint: `sha256:${'b'.repeat(64)}`, observedCveIds: ['CVE-2026-10001'] },
  ]),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'REVIEWED_ARTICLE_CONTENT_CHANGED',
)
assert.doesNotThrow(() => assertSecurityFeedPageStateContinuity(inventoryPageStates, [
  { articleId: 'kb1002', productIds: ['veeam-one'], hasOutOfScopeProduct: false, contentFingerprint: `sha256:${'b'.repeat(64)}`, observedCveIds: ['CVE-2026-10001', 'CVE-2026-10002'] },
]))
assert.throws(
  () => assertSecurityFeedPageStateContinuity(inventoryPageStates, [
    { articleId: 'kb1002', productIds: ['veeam-one'], hasOutOfScopeProduct: false, contentFingerprint: `sha256:${'b'.repeat(64)}`, observedCveIds: [] },
  ]),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'REVIEWED_ARTICLE_CONTENT_CHANGED',
)

await assert.rejects(
  fetchSecurityFeedPages({ fetchPage: () => ({ totalSize: 0, articles: [] }) }),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'FEED_TOTAL_BELOW_MINIMUM',
)
await assert.rejects(
  fetchSecurityFeedPages({
    minimumArticleCount: 2,
    fetchPage: () => ({ totalSize: 1, articles: [pagedArticles[0]] }),
  }),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'FEED_TOTAL_BELOW_MINIMUM',
)
await assert.rejects(
  fetchSecurityFeedPages({
    pageSize: 1,
    fetchPage: ({ offset }) => ({ totalSize: 2, articles: offset === 0 ? [pagedArticles[0]] : [] }),
  }),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'FEED_PAGE_EMPTY',
)
await assert.rejects(
  fetchSecurityFeedPages({
    pageSize: 1,
    fetchPage: ({ offset }) => ({ totalSize: 2, articles: [offset === 0 ? pagedArticles[0] : pagedArticles[0]] }),
  }),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'FEED_DUPLICATE_ARTICLE',
)
await assert.rejects(
  fetchSecurityFeedPages({
    pageSize: 1,
    fetchPage: ({ offset }) => ({ totalSize: offset === 0 ? 2 : 3, articles: [pagedArticles[offset]] }),
  }),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'FEED_TOTAL_CHANGED',
)

const classificationArticles = [
  article('kb1101', ['Veeam Backup & Replication']),
  article('kb1102', ['Veeam ONE']),
  article('kb1103', ['Veeam Service Provider Console']),
  article('kb1104', ['Veeam Agent for Microsoft Windows'], 'Veeam Agent for Microsoft Windows vulnerability'),
  article('kb1105', ['Veeam Recovery Orchestrator']),
  article('kb1106', ['Veeam Backup Enterprise Manager', 'Veeam Backup & Replication']),
  article('kb1107', ['Veeam Backup for Microsoft 365']),
  article('kb1108', [], 'A Veeam ONE security advisory with incomplete metadata'),
  article('kb1109', ['Veeam ONE']),
  article('kb1116', ['Renamed Veeam Security Product']),
]
const classified = classifySecurityFeedArticles({
  articles: classificationArticles,
  classifications: {
    kb1101: { classification: 'parsed', productIds: ['vbr'] },
    kb1102: { classification: 'dedicated', productIds: ['veeam-one'] },
    kb1103: { classification: 'inventory', productIds: ['vspc'] },
    kb1106: { classification: 'parsed', productIds: ['enterprise-manager', 'vbr'] },
    kb1107: { classification: 'dedicated', productIds: ['vb365'] },
    kb1109: { classification: 'out-of-scope' },
  },
})
assert.deepEqual(classified.map(({ classification }) => classification), [
  'parsed',
  'dedicated',
  'inventory',
  'unclassified',
  'unclassified',
  'unclassified',
  'dedicated',
  'unclassified',
  'unclassified',
  'unclassified',
])
assert.equal(classified[5].reasonCode, 'MULTI_PRODUCT_ADAPTER_REQUIRED')
assert.equal(classified[3].reasonCode, 'UNCLASSIFIED_SECURITY_ARTICLE')
assert.equal(classified[7].reasonCode, 'UNCLASSIFIED_SECURITY_ARTICLE')
assert.equal(classified[8].reasonCode, 'TRACKED_ARTICLE_MARKED_OUT_OF_SCOPE')
assert.equal(classified[9].reasonCode, 'UNCLASSIFIED_SECURITY_ARTICLE')
assert.deepEqual(classified[5].productIds, ['enterprise-manager', 'vbr'])
const reviewedSingleProduct = classifySecurityFeedArticles({
  articles: [article('kb1114', ['Veeam Backup & Replication', 'Veeam Agent for Microsoft Windows'])],
  classifications: { kb1114: { classification: 'dedicated', productIds: ['vbr'], ignoredCveIds: ['CVE-2026-11142'], multiProduct: false } },
})
assert.equal(reviewedSingleProduct[0].classification, 'dedicated')
assert.equal(reviewedSingleProduct[0].multiProduct, false)
assert.deepEqual(reviewedSingleProduct[0].productIds, ['vbr'])
const unreviewedMixedMetadata = classifySecurityFeedArticles({
  articles: [article('kb1115', ['Veeam Backup & Replication', 'Veeam Cloud Connect'])],
  classifications: { kb1115: { classification: 'parsed', productIds: ['vbr'] } },
})
assert.equal(unreviewedMixedMetadata[0].classification, 'unclassified')
assert.equal(unreviewedMixedMetadata[0].reasonCode, 'MULTI_PRODUCT_ADAPTER_REQUIRED')
const unreviewedMixedTitleArticle = article('kb1118', ['Veeam Backup & Replication'], 'VBR and Veeam Agent for Microsoft Windows vulnerabilities')
const unreviewedMixedTitle = classifySecurityFeedArticles({
  articles: [unreviewedMixedTitleArticle],
  classifications: buildSecurityArticleClassifications([unreviewedMixedTitleArticle]),
})
assert.equal(unreviewedMixedTitle[0].classification, 'unclassified')
assert.equal(unreviewedMixedTitle[0].reasonCode, 'MULTI_PRODUCT_ADAPTER_REQUIRED')
const renamedProductArticle = article('kb1117', ['Renamed Veeam Security Product'], 'A Veeam ONE vulnerability')
const renamedTrackedProduct = classifySecurityFeedArticles({
  articles: [renamedProductArticle],
  classifications: buildSecurityArticleClassifications([renamedProductArticle]),
})
assert.equal(renamedTrackedProduct[0].classification, 'unclassified')
assert.equal(renamedTrackedProduct[0].reasonCode, 'UNCLASSIFIED_SECURITY_ARTICLE')
assert.deepEqual(
  inferSecurityArticleProducts(article('kb4682', ['Veeam Backup & Replication'], 'Veeam Backup Enterprise Manager Vulnerability')).productIds,
  ['enterprise-manager'],
)
assert.deepEqual(
  inferSecurityArticleProducts(article('kb1110', ['Veeam Backup for Microsoft 365 8'], 'Microsoft 365 advisory')).productIds,
  ['vb365'],
)
const futureRoutes = buildSecurityArticleClassifications([
  article('kb1111', ['Veeam Recovery Orchestrator']),
  article('kb1112', [], 'Veeam Backup Enterprise Manager vulnerability'),
  article('kb1113', ['Veeam Backup for Microsoft 365 8']),
])
assert.deepEqual(futureRoutes, {
  kb1111: { classification: 'parsed', productIds: ['vro'], multiProduct: false },
  kb1112: { classification: 'parsed', productIds: ['enterprise-manager'], multiProduct: false },
  kb1113: { classification: 'parsed', productIds: ['vb365'], multiProduct: false },
})

const informationalHtml = '<h1>VSPC patch notice</h1><p>No vulnerability finding is assigned.</p>'
const informationalRoute = {
  classification: 'informational',
  productIds: ['vspc'],
  informationalReason: 'NO_VENDOR_VULNERABILITY_FINDING',
  contentFingerprint: fingerprintSecurityArticleContent(informationalHtml),
}
const informationalCovered = assertSecurityFeedCoverage({
  articles: [article('kb4163', ['Veeam Service Provider Console'])],
  classifications: { kb4163: informationalRoute },
  articlePages: { kb4163: informationalHtml },
})
assert.equal(informationalCovered.articles[0].classification, 'informational')
const informationalChanged = inspectSecurityFeedCoverage({
  articles: [article('kb4163', ['Veeam Service Provider Console'])],
  classifications: { kb4163: informationalRoute },
  articlePages: { kb4163: `${informationalHtml}<p>Editorial change</p>` },
})
assert.deepEqual(findingCodes(informationalChanged.report), ['INFORMATIONAL_CONTENT_CHANGED'])
const informationalCveHtml = `${informationalHtml}<p>CVE-2026-41630</p>`
const informationalCve = inspectSecurityFeedCoverage({
  articles: [article('kb4163', ['Veeam Service Provider Console'])],
  classifications: { kb4163: { ...informationalRoute, contentFingerprint: fingerprintSecurityArticleContent(informationalCveHtml) } },
  articlePages: { kb4163: informationalCveHtml },
})
assert.deepEqual(findingCodes(informationalCve.report), ['INFORMATIONAL_CVE_OBSERVED'])
assertSecurityFeedCoverage({
  articles: [article('kb4163', ['Veeam Service Provider Console'])],
  classifications: { kb4163: { ...informationalRoute, contentFingerprint: fingerprintSecurityArticleContent(informationalCveHtml), ignoredCveIds: ['CVE-2026-41630'] } },
  articlePages: { kb4163: informationalCveHtml },
})
const informationalMissing = inspectSecurityFeedCoverage({
  articles: [article('kb4163', ['Veeam Service Provider Console'])],
  classifications: { kb4163: informationalRoute },
})
assert.deepEqual(findingCodes(informationalMissing.report), ['ARTICLE_PAGE_MISSING'])
assert.throws(
  () => classifySecurityFeedArticles({
    articles: [article('kb4163', ['Veeam Service Provider Console'])],
    classifications: { kb4163: { classification: 'informational', productIds: ['vspc'] } },
  }),
  (error) => error instanceof SecurityFeedCoverageError && error.report.findings[0].code === 'INVALID_CLASSIFICATION',
)

assert.deepEqual(extractCveIds('CVE-2026-10001 cve-2025-9999 CVE-2026-10001 CVE-26-1234'), ['CVE-2025-9999', 'CVE-2026-10001'])
assert.deepEqual(
  extractSecurityArticleScope('<h1>VBR advisory</h1><h4>CVE-2026-10001</h4><p>Affects VSPC.</p><h2>Solution</h2><p>Veeam Agent for Linux</p>'),
  { productIds: ['vbr', 'vspc'], hasOutOfScopeProduct: false },
)
assert.deepEqual(
  extractSecurityArticleScope('<h1>VBR advisory</h1><h4>CVE-2026-10001</h4><p>Affects Veeam Agent for Linux.</p><h2>Solution</h2>'),
  { productIds: ['vbr'], hasOutOfScopeProduct: true },
)

const coveredArticles = [
  article('kb2001', ['Veeam Backup & Replication']),
  article('kb2002', ['Veeam ONE']),
  article('kb2003', ['Veeam ONE']),
  article('kb4879', ['Veeam Recovery Orchestrator']),
  article('kb2004', ['Veeam Agent for Linux'], 'Veeam Agent for Linux vulnerability'),
]
const coveredClassifications = {
  kb2001: { classification: 'parsed', productIds: ['vbr'] },
  kb2002: { classification: 'dedicated', productIds: ['veeam-one'] },
  kb2003: { classification: 'inventory', productIds: ['veeam-one'] },
  kb4879: { classification: 'parsed', productIds: ['vro'], allowNoCves: true },
  kb2004: { classification: 'out-of-scope' },
}
const coveredPages = {
  kb2001: '<h4>CVE-2026-10001</h4><p>CVE-2026-10002</p>',
  kb2002: '<h4>CVE-2026-20001</h4>',
  kb2003: '<p>Inventory contains CVE-2026-20001.</p>',
  kb4879: '<p>This vendor advisory does not assign a CVE identifier.</p>',
  kb2004: '<h1>Veeam Agent for Linux vulnerability</h1><h4>CVE-2026-20004</h4>',
}
const coveredParsed = [
  { articleId: 'kb2001', productId: 'vbr', cveIds: ['CVE-2026-10001', 'CVE-2026-10002'] },
  { source: { id: 'kb2002' }, productId: 'veeam-one', records: [{ cve: 'CVE-2026-20001' }] },
  { articleId: 'kb4879', productId: 'vro', cveIds: [] },
]
const coveredCatalog = { securityFindings: [
  catalogFinding('kb2001', 'vbr', ['CVE-2026-10001']),
  catalogFinding('kb2001', 'vbr', ['CVE-2026-10002']),
  catalogFinding('kb2002', 'veeam-one', ['CVE-2026-20001']),
  catalogFinding('kb4879', 'vro', []),
] }
const covered = assertSecurityFeedCoverage({
  articles: coveredArticles,
  classifications: coveredClassifications,
  articlePages: coveredPages,
  parsedCoverage: coveredParsed,
  catalog: coveredCatalog,
})
assert.equal(covered.report.ok, true)
assert.deepEqual(covered.articles.map(({ classification }) => classification), ['parsed', 'dedicated', 'inventory', 'parsed', 'out-of-scope'])

const changedBodyScope = inspectSecurityFeedCoverage({
  articles: [article('kb2005', ['Veeam Backup & Replication'])],
  classifications: { kb2005: { classification: 'parsed', productIds: ['vbr'] } },
  articlePages: { kb2005: { html: '<h1>VBR and VSPC</h1><h4>CVE-2026-20005</h4>', observedProductIds: ['vbr', 'vspc'], observedOutOfScopeProduct: false } },
  parsedCoverage: [{ articleId: 'kb2005', productId: 'vbr', cveIds: ['CVE-2026-20005'] }],
  catalog: { securityFindings: [catalogFinding('kb2005', 'vbr', ['CVE-2026-20005'])] },
})
assert.deepEqual(findingCodes(changedBodyScope.report), ['ARTICLE_PRODUCT_SCOPE_CHANGED'])

const trailingCveScope = inspectSecurityFeedCoverage({
  articles: [article('kb2006', ['Veeam Backup & Replication'])],
  classifications: { kb2006: { classification: 'parsed', productIds: ['vbr'] } },
  articlePages: { kb2006: { html: '<h1>VBR</h1><h4>CVE-2026-20006</h4>', trailingCveIds: ['CVE-2026-20007'] } },
  parsedCoverage: [{ articleId: 'kb2006', productId: 'vbr', cveIds: ['CVE-2026-20006'] }],
  catalog: { securityFindings: [catalogFinding('kb2006', 'vbr', ['CVE-2026-20006'])] },
})
assert.deepEqual(findingCodes(trailingCveScope.report), ['ARTICLE_CVE_OUTSIDE_VULNERABILITY_SCOPE'])

const noCveMissingSources = inspectSecurityFeedCoverage({
  articles: [article('kb4879', ['Veeam Recovery Orchestrator'])],
  classifications: { kb4879: { classification: 'parsed', productIds: ['vro'], allowNoCves: true } },
  articlePages: { kb4879: '<p>No CVE is assigned.</p>' },
  parsedCoverage: [],
  catalog: { securityFindings: [] },
})
assert.deepEqual(findingCodes(noCveMissingSources.report), ['CATALOG_SOURCE_MISSING', 'PARSED_SOURCE_MISSING'])

const partial = inspectSecurityFeedCoverage({
  articles: [article('kb2101', ['Veeam ONE'])],
  classifications: { kb2101: { classification: 'parsed', productIds: ['veeam-one'] } },
  articlePages: { kb2101: '<h4>CVE-2026-21001</h4><h4>CVE-2026-21002</h4>' },
  parsedCoverage: [{ articleId: 'kb2101', productId: 'veeam-one', cveIds: ['CVE-2026-21001'] }],
  catalog: { securityFindings: [catalogFinding('kb2101', 'veeam-one', ['CVE-2026-21001'])] },
})
assert.deepEqual(findingCodes(partial.report), ['CATALOG_CVE_MISSING', 'PARSED_CVE_MISSING'])
assert(partial.report.findings.every((finding) => finding.cveIds.includes('CVE-2026-21002')))

const inventoryGap = inspectSecurityFeedCoverage({
  articles: [article('kb2201', ['Veeam ONE']), article('kb2202', ['Veeam ONE'])],
  classifications: {
    kb2201: { classification: 'parsed', productIds: ['veeam-one'] },
    kb2202: { classification: 'inventory', productIds: ['veeam-one'] },
  },
  articlePages: {
    kb2201: '<h4>CVE-2026-22001</h4>',
    kb2202: '<p>CVE-2026-22001 and CVE-2026-22002</p>',
  },
  parsedCoverage: [{ articleId: 'kb2201', productId: 'veeam-one', cveIds: ['CVE-2026-22001'] }],
  catalog: { securityFindings: [catalogFinding('kb2201', 'veeam-one', ['CVE-2026-22001'])] },
})
assert.deepEqual(findingCodes(inventoryGap.report), ['INVENTORY_CATALOG_CVE_MISSING', 'INVENTORY_PARSED_CVE_MISSING'])

const multiProductArticle = article('kb2301', ['Veeam Backup & Replication', 'Veeam ONE'])
const multiProductBase = {
  articles: [multiProductArticle],
  classifications: { kb2301: { classification: 'dedicated', productIds: ['vbr', 'veeam-one'] } },
  parsedCoverage: [
    { articleId: 'kb2301', productId: 'vbr', cveIds: ['CVE-2026-23001'] },
    { articleId: 'kb2301', productId: 'veeam-one', cveIds: ['CVE-2026-23002'] },
  ],
  catalog: { securityFindings: [
    catalogFinding('kb2301', 'vbr', ['CVE-2026-23001']),
    catalogFinding('kb2301', 'veeam-one', ['CVE-2026-23002']),
  ] },
}
const multiProductCovered = assertSecurityFeedCoverage({
  ...multiProductBase,
  articlePages: { kb2301: {
    html: '<h4>CVE-2026-23001</h4><h4>CVE-2026-23002</h4>',
    observedCvesByProduct: { vbr: ['CVE-2026-23001'], 'veeam-one': ['CVE-2026-23002'] },
  } },
})
assert.equal(multiProductCovered.report.ok, true)

const multiProductPartial = inspectSecurityFeedCoverage({
  ...multiProductBase,
  articlePages: { kb2301: {
    html: '<h4>CVE-2026-23001</h4><h4>CVE-2026-23002</h4><h4>CVE-2026-23003</h4>',
    observedCvesByProduct: { vbr: ['CVE-2026-23001'] },
  } },
})
assert.deepEqual(findingCodes(multiProductPartial.report), ['PARTIAL_MULTI_PRODUCT_PARSE', 'UNSCOPED_MULTI_PRODUCT_CVE'])
assert(multiProductPartial.report.findings.find((finding) => finding.code === 'UNSCOPED_MULTI_PRODUCT_CVE').cveIds.includes('CVE-2026-23003'))

const genericMultiProduct = inspectSecurityFeedCoverage({
  articles: [multiProductArticle],
  classifications: { kb2301: { classification: 'parsed', productIds: ['vbr', 'veeam-one'] } },
})
assert.deepEqual(findingCodes(genericMultiProduct.report), ['MULTI_PRODUCT_ADAPTER_REQUIRED'])

const ordered = createSecurityFeedCoverageReport([
  { code: 'PARSED_CVE_MISSING', articleId: 'kb9999', productIds: ['vbr'], cveIds: ['CVE-2026-99992'] },
  { code: 'CATALOG_CVE_MISSING', articleId: 'kb9999', productIds: ['vbr'], cveIds: ['CVE-2026-99991'] },
])
const reversed = createSecurityFeedCoverageReport([...ordered.findings].reverse())
assert.equal(ordered.fingerprint, reversed.fingerprint)

let safeError
try {
  assertSecurityFeedCoverage({
    articles: [article('kb9901', [], '<script>secret-token @everyone</script>')],
  })
} catch (error) {
  safeError = error
}
assert(safeError instanceof SecurityFeedCoverageError)
const serializedError = JSON.stringify(safeError)
assert(!serializedError.includes('secret-token'))
assert(!serializedError.includes('@everyone'))
assert(!serializedError.includes('<script>'))
assert.match(safeError.message, /^Security feed coverage failed with 1 finding\(s\); fingerprint sha256:[a-f0-9]{64}\.$/)

console.log('Security feed coverage tests passed.')
