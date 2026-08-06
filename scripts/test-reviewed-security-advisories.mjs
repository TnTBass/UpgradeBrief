import assert from 'node:assert/strict'
import {
  REVIEWED_SECURITY_ADVISORIES,
  REVIEWED_SECURITY_CLASSIFICATIONS,
  REVIEWED_SECURITY_OBSERVATION_POLICY,
  REVIEWED_SECURITY_PARSED_COVERAGE,
  ReviewedSecurityObservationError,
  extractReviewedSecurityCveIds,
  fingerprintReviewedSecurityMainArticle,
  mergeReviewedSecurityAdvisories,
  normalizeReviewedSecurityMainArticle,
  observeReviewedSecurityArticle,
} from './lib/reviewed-security-advisories.mjs'

assert.deepEqual(extractReviewedSecurityCveIds('CVE20155742 and CVE-2024-40715'), ['CVE-2015-5742', 'CVE-2024-40715'])

for (const [articleId, policy] of Object.entries(REVIEWED_SECURITY_OBSERVATION_POLICY)) {
  if (policy.classification === 'informational') {
    assert.match(policy.contentFingerprint, /^sha256:[a-f0-9]{64}$/)
    continue
  }
  const content = policy.expectedCveIds.join(' ')
  const observation = observeReviewedSecurityArticle(articleId.toUpperCase(), content)
  assert.deepEqual(observation.observedCves, policy.expectedCveIds, `${articleId} did not retain its reviewed page-CVE set`)
}

assert.throws(
  () => observeReviewedSecurityArticle('kb4771', 'CVE-2025-48983 CVE-2025-48984'),
  (error) => error instanceof ReviewedSecurityObservationError && error.missingCveIds.includes('CVE-2025-48982'),
)
assert.throws(
  () => observeReviewedSecurityArticle('kb4879', 'CVE-2099-9999'),
  (error) => error instanceof ReviewedSecurityObservationError && error.unexpectedCveIds.includes('CVE-2099-9999'),
)

assert.deepEqual(REVIEWED_SECURITY_CLASSIFICATIONS.kb4508.productIds, ['veeam-one', 'vro'])
assert.equal(REVIEWED_SECURITY_CLASSIFICATIONS.kb4508.multiProduct, true)
assert.equal(REVIEWED_SECURITY_CLASSIFICATIONS.kb4857.classification, 'informational')
assert.equal(REVIEWED_SECURITY_CLASSIFICATIONS.kb4857.allowNoCves, true)
assert.equal(REVIEWED_SECURITY_CLASSIFICATIONS.kb4712.informationalReason, 'UNTRACKED_MANAGED_COMPONENT')
assert.deepEqual(REVIEWED_SECURITY_CLASSIFICATIONS.kb4712.ignoredCveIds, ['CVE-2025-23114'])
assert.equal(REVIEWED_SECURITY_CLASSIFICATIONS.kb4709.informationalReason, 'UNTRACKED_MANAGED_COMPONENT')

const kb4649 = REVIEWED_SECURITY_OBSERVATION_POLICY.kb4649
const kb4649Observation = observeReviewedSecurityArticle('kb4649', kb4649.expectedCveIds.join(' '))
assert.deepEqual(Object.keys(kb4649Observation.observedCvesByProduct), ['vbr', 'veeam-one', 'vspc'])
assert.equal(kb4649Observation.observedCvesByProduct.vbr.includes('CVE-2024-40709'), false)
assert.equal(kb4649Observation.observedCvesByProduct.vspc.length, 5)

const semanticOne = '<nav>first chrome</nav><h1>Reviewed article</h1><p>Stable issue text.</p><div>Thank you!</div><footer>first footer</footer>'
const semanticTwo = '<nav>changed chrome</nav><h1>Reviewed article</h1><p>Stable issue text.</p><div>Thank you!</div><footer>changed footer</footer>'
assert.equal(normalizeReviewedSecurityMainArticle(semanticOne), 'Reviewed article Stable issue text.')
assert.equal(fingerprintReviewedSecurityMainArticle(semanticOne), fingerprintReviewedSecurityMainArticle(semanticTwo))

const coverage = (articleId, productId) => REVIEWED_SECURITY_PARSED_COVERAGE
  .find((record) => record.articleId === articleId && record.productId === productId)?.cveIds ?? []
assert.deepEqual(coverage('kb4771', 'vbr'), ['CVE-2025-48983', 'CVE-2025-48984'])
assert.deepEqual(coverage('kb4743', 'vbr'), ['CVE-2025-23121', 'CVE-2025-24286'])
assert.deepEqual(coverage('kb4693', 'vbr').includes('CVE-2024-45207'), false)
assert.deepEqual(coverage('kb4852', 'vbr'), ['CVE-2026-32997'])
assert.deepEqual(coverage('kb4581', 'enterprise-manager'), ['CVE-2024-29849', 'CVE-2024-29850', 'CVE-2024-29851', 'CVE-2024-29852'])
assert.deepEqual(coverage('kb4541', 'vro'), ['CVE-2024-22021', 'CVE-2024-22022'])
assert.deepEqual(coverage('kb4585', 'vro'), ['CVE-2024-29855'])
assert.deepEqual(coverage('kb4857', 'vro'), [])

const releaseProducts = new Map()
for (const advisory of REVIEWED_SECURITY_ADVISORIES) {
  for (const releaseId of [...(advisory.affectedReleaseIds ?? []), ...(advisory.fixedReleaseId ? [advisory.fixedReleaseId] : [])]) {
    releaseProducts.set(releaseId, advisory.productId)
  }
}
const base = {
  sources: [{ id: 'kb4581', title: 'stale', url: 'https://example.invalid', checkedAt: '2020-01-01T00:00:00.000Z' }],
  releases: [...releaseProducts].map(([id, productId]) => ({ id, productId, aliases: [] })),
  securityFindings: [
    { id: 'keep', productId: 'vbr', cves: ['CVE-2000-0001'], sourceIds: ['kb9999'] },
    { id: 'vbr-cve-2024-45207', productId: 'vbr', cves: ['CVE-2024-45207'], sourceIds: ['security-kb', 'kb4693'] },
    { id: 'vbr-cve-2026-32996', productId: 'vbr', cves: ['CVE-2026-32996'], sourceIds: ['security-kb', 'kb4852'] },
    { id: 'em-cve-2024-29849', productId: 'enterprise-manager', cves: ['CVE-2024-29849'], sourceIds: ['kb4581'], isCisaKev: false },
  ],
}

const merged = mergeReviewedSecurityAdvisories(base, { checkedAt: '2026-08-06T00:00:00.000Z' })
assert.equal(merged.catalog.securityFindings.some((finding) => finding.id === 'keep'), true)
assert.equal(merged.catalog.securityFindings.some((finding) => finding.id === 'vbr-cve-2024-45207'), false)
assert.equal(merged.catalog.securityFindings.some((finding) => finding.id === 'vbr-cve-2026-32996'), false)
assert.equal(merged.catalog.securityFindings.filter((finding) => finding.sourceIds.includes('kb4693')).length, 8)
assert.equal(merged.catalog.securityFindings.filter((finding) => finding.sourceIds.includes('kb4508') && finding.productId === 'vro').length, 4)
assert.equal(merged.catalog.securityFindings.filter((finding) => finding.sourceIds.includes('kb4581')).length, 4)
assert.equal(merged.catalog.securityFindings.filter((finding) => finding.sourceIds.includes('kb4541')).length, 2)
assert.equal(merged.catalog.securityFindings.filter((finding) => finding.sourceIds.includes('kb4585')).length, 1)

for (const articleId of ['kb4879', 'kb4491']) {
  const [finding] = merged.catalog.securityFindings.filter((item) => item.sourceIds.includes(articleId))
  assert.deepEqual(finding.cves, [], `${articleId} must retain a source-backed no-CVE finding`)
  assert.equal(merged.catalog.sources.some((source) => source.id === articleId), true)
}
assert.equal(merged.catalog.sources.find((source) => source.id === 'kb4581').url, 'https://www.veeam.com/kb4581')
assert.equal(merged.catalog.sources.some((source) => source.id === 'kb4857'), true)

const mergedAgain = mergeReviewedSecurityAdvisories(merged.catalog)
assert.equal(mergedAgain.catalog.securityFindings.length, merged.catalog.securityFindings.length, 'reviewed merge must be idempotent and article-scoped')
assert.equal(new Set(mergedAgain.catalog.securityFindings.map((finding) => finding.id)).size, mergedAgain.catalog.securityFindings.length)

console.log('Reviewed cross-product security advisory fixture test passed.')
