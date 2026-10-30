import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRepairEvidence } from './lib/catalog-repair-evidence.mjs'
import { buildRepairCandidate } from './lib/catalog-repair-candidate.mjs'
import { createSecurityReviewBaseline, reconcileSecurityReviewBaselines, normalizeSecurityReviewText } from './lib/security-review-baselines.mjs'
import { parseSectionedSecurityArticle } from './lib/sectioned-security.mjs'
import { supportedInventoryExpansion } from './lib/inventory-expansion.mjs'
import { catalogFreshness, combinedCatalogFreshness, workflowFailureIdentity, updateFailureOccurrence } from './lib/catalog-health.mjs'
import { assertSecurityFeedPageStateContinuity } from './lib/security-feed-coverage.mjs'
import { mergeReviewedSecurityAdvisories } from './lib/reviewed-security-advisories.mjs'
import { mergeEnterpriseManagerBuilds } from './lib/enterprise-manager-builds.mjs'

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const report = await read('./fixtures/catalog-repair/2026-10-30-source-review.json')
const policy = await read('./data/reviewed-security-advisories.json')
const baseCommit = 'a'.repeat(40)
function replay(sourceReport) {
  const reviewedData = structuredClone(policy)
  const baselines = { schemaVersion: 1, articles: {} }
  for (const change of sourceReport.changes) if (change.before !== null) {
    const oldFingerprint = createSecurityReviewBaseline(change.articleId, change.before).contentFingerprint
    if (reviewedData.observationSpecs[change.articleId]?.contentFingerprint) reviewedData.observationSpecs[change.articleId].contentFingerprint = oldFingerprint
    baselines.articles[change.articleId] = createSecurityReviewBaseline(change.articleId, change.before, reviewedData.observationSpecs[change.articleId]?.contentFingerprint)
  }
  const bundle = createRepairEvidence({ report: sourceReport, baseCommit, policy: reviewedData, runId: '41043898632', capturedAt: report.capturedAt })
  return {
    bundle, reviewedData, baselines, currentCommit: baseCommit,
    catalog: {
      securityFeedArticleIds: sourceReport.changes.filter(c => c.acceptedRoute).map(c => c.articleId),
      securityFeedPageStates: sourceReport.changes.flatMap(c => c.acceptedPageState ? [c.acceptedPageState] : []),
      securityFeedRoutes: sourceReport.changes.flatMap(c => c.acceptedRoute ? [c.acceptedRoute] : []),
    },
    proposal: { schemaVersion: 1, baseCommit, evidenceId: bundle.evidenceId, articles: bundle.articles.map(article => ({ articleId: article.articleId, kind: 'equivalent', rationale: 'Replay archived failure.', unresolved: [], evidence: [{ sectionId: 'article', start: 0, end: article.after.length, quote: article.after }] })) },
  }
}
const batch = buildRepairCandidate(replay(report))
assert.equal(batch.status, 'blocked')
assert.deepEqual(batch.files, {})
assert.ok(batch.blocked.some(item => item.articleId === 'kb4853' && item.code === 'PARSED_ARTICLE_REQUIRES_REFRESH'))
assert.ok(batch.blocked.some(item => item.articleId === 'kb4957' && item.code === 'NEW_ARTICLE_REQUIRES_CLASSIFICATION'))
assert.ok(batch.blocked.some(item => item.articleId === 'kb3103'), 'All blockers survive the parsed article')
const parsed = structuredClone(report.changes.find(change => change.articleId === 'kb4853'))
parsed.after = parsed.before.replace(/Last Modified: \d{4}-\d{2}-\d{2}/, 'Last Modified: 2026-10-30')
const isolated = replay({ ...report, error: { message: 'changed', report: { findings: [{ code: 'REVIEWED_ARTICLE_CONTENT_CHANGED', articleId: 'kb4853' }] } }, changes: [parsed] })
const result = buildRepairCandidate(isolated)
assert.equal(result.status, 'candidate-ready')
assert.equal(result.files['src/data/catalog.snapshot.json'], undefined, 'Parsed pages must not acquire a fingerprint')
const broken = replay(report)
broken.catalog = structuredClone(broken.catalog)
delete broken.catalog.securityFeedPageStates.find(page => page.articleId === 'kb3103').contentFingerprint
assert.throws(() => buildRepairCandidate(broken), /accepted fingerprint contract changed/)

const modern = id => report.changes.find(change => change.articleId === id).after
const one = parseSectionedSecurityArticle(modern('kb4951'), { id: 'kb4951', seoTitle: 'Veeam ONE' }, { productId: 'veeam-one', productName: 'Veeam ONE' })
assert.equal(one.records[0].cve, 'CVE-2026-107671')
assert.equal(one.records[0].fixedBuild, '13.1.0.7940')
const product = { productId: 'vb365', productName: 'Veeam Backup for Microsoft 365' }
const vb = parseSectionedSecurityArticle(modern('kb4957'), { id: 'kb4957' }, product)
assert.ok(new Set(vb.records.map(record => record.fixedBuild)).size > 1, 'Per-CVE fixes must remain distinct')
assert.deepEqual(vb.records.map(record => [record.cve, record.cvssScore, record.affectedBuildRanges[0].throughBuild, record.fixedBuild]), [
  ['CVE-2026-106076', 9, '8.5.0.1014', '8.6.0.1102'],
  ['CVE-2026-106077', 8.3, '8.5.0.1014', '8.6.0.1102'],
  ['CVE-2026-106078', 6.9, '8.6.0.1102', '8.6.0.5011'],
  ['CVE-2025-64394', 4.3, '8.6.0.1102', '8.6.0.5011'],
])
assert.ok(vb.records.every(record => record.affectedBuildRanges[0].versionPrefix === '8.'))
assert.match(policy.advisories.find(advisory => advisory.articleId === 'kb4682').remediation, /12\.3\.0\.310/)
const snapshot = await read('../src/data/catalog.snapshot.json')
assert.doesNotThrow(() => mergeReviewedSecurityAdvisories(mergeEnterpriseManagerBuilds(snapshot).catalog), 'Real release catalog must resolve every reviewed fixed-release reference')
assert.ok(!policy.advisories.find(advisory => advisory.articleId === 'kb4724').records[0].conditions.some(condition => condition.includes('offers a build-specific hotfix')))
for (const mutate of [
  text => text + ' CVE-2099-99999',
  text => text + ' Disable authentication before upgrading.',
  text => text.replace('Affected Product', 'Unsupported Product'),
  text => text.replace('Affected Product Veeam Backup for Microsoft 365', 'Affected Product Veeam ONE'),
]) assert.throws(() => parseSectionedSecurityArticle(mutate(modern('kb4957')), { id: 'kb4957' }, product))
assert.throws(() => parseSectionedSecurityArticle(modern('kb4948'), { id: 'kb4948' }, { productId: 'vbr', productName: 'Veeam Backup & Replication' }), /kb4948/, 'Mixed products need a reviewed mapping')

const prefix = 'Inventory KB ID: 4858 Product: Veeam ONE Published: 2026-01-01 Last Modified: 2026-01-01 Purpose Security Fixes and Improvements '
const before = prefix + '13.1.0.7930 CVE-2026-10000 vulnerability was fixed.'
const after = prefix + '13.1.0.7940 CVE-2026-107671 vulnerability was fixed. libxml2 upgraded to version 2.14.6 ' + before.slice(prefix.length)
assert.equal(supportedInventoryExpansion('kb4858', before, after), true)
for (const altered of [after + ' ignored', after.replace('was fixed.', 'is not affected.'), after.replace('13.1.0.7940', '12.1.0.7940'), after.replace('libxml2 upgraded', 'Unknown instructions: libxml2 upgraded')]) assert.equal(supportedInventoryExpansion('kb4858', before, altered), false)
assert.equal(supportedInventoryExpansion('kb9999', before, after), false)
for (const [id, supported] of [['kb4858', true], ['kb3103', false], ['kb4857', false]]) {
  const change = report.changes.find(change => change.articleId === id)
  assert.equal(supportedInventoryExpansion(id, normalizeSecurityReviewText(id, change.before), normalizeSecurityReviewText(id, change.after)), supported, 'Archived inventory: ' + id)
}
const baseline = createSecurityReviewBaseline('kb4858', before)
const state = { articleId: 'kb4858', productIds: ['veeam-one'], hasOutOfScopeProduct: false, contentFingerprint: baseline.contentFingerprint }
const next = { ...state, contentFingerprint: createSecurityReviewBaseline('kb4858', after).contentFingerprint }
const input = { baselines: { schemaVersion: 1, articles: { kb4858: baseline } }, previousStates: [state], states: [next], texts: { kb4858: after }, policies: { kb4858: { classification: 'inventory' } } }
const expanded = reconcileSecurityReviewBaselines(input)
assert.deepEqual(expanded.inventoryChanges, ['kb4858'])
assert.deepEqual(expanded.equivalentChanges, [])
assert.doesNotThrow(() => assertSecurityFeedPageStateContinuity(expanded.continuityStates, [next], { allowInventoryExpansion: false }))
const repeat = reconcileSecurityReviewBaselines({ ...input, baselines: expanded.next, previousStates: [next] })
assert.equal(repeat.acceptedFingerprints.kb4858, next.contentFingerprint, 'Subsequent refresh still validates accepted inventory')

const now = Date.parse('2026-10-30T12:00:00Z')
for (const [hours, level] of [[35.99, 'healthy'], [36, 'warning'], [71.99, 'warning'], [72, 'critical']]) assert.equal(catalogFreshness(new Date(now - hours * 3_600_000).toISOString(), now).level, level)
assert.equal(catalogFreshness('invalid', now).level, 'critical')
assert.equal(catalogFreshness(new Date(now + 3_600_000).toISOString(), now).level, 'critical')
const publication = { schemaVersion: 1, commit: 'a'.repeat(40), catalogHash: 'b'.repeat(64), generatedAt: new Date(now - 73 * 3_600_000).toISOString() }
assert.equal(combinedCatalogFreshness(new Date(now).toISOString(), publication, now).level, 'critical', 'Fresh main cannot conceal stale deployment')
assert.equal(combinedCatalogFreshness(new Date(now).toISOString(), undefined, now).deployment.reason, 'published-health-unavailable')
assert.equal(combinedCatalogFreshness(new Date(now).toISOString(), { ...publication, generatedAt: new Date(now).toISOString() }, now).level, 'healthy')
const detail = { schemaVersion: 1, code: 'REPAIR_PREPARATION_FAILED', articleId: 'kb4853', message: 'kb4853 accepted text changed' }
assert.notEqual(workflowFailureIdentity(['prepare'], detail).id, workflowFailureIdentity(['prepare'], { ...detail, articleId: 'kb3144', message: 'kb3144 accepted scope changed' }).id)
assert.equal(workflowFailureIdentity(['prepare'], detail).id, workflowFailureIdentity(['prepare'], { ...detail, capturedAt: 'tomorrow' }).id)
const first = updateFailureOccurrence('Reviewer note.', { runId: '1', url: 'https://example.com/1', failed: ['prepare'], detail })
const second = updateFailureOccurrence(first, { runId: '2', url: 'https://example.com/2', failed: ['prepare'], detail })
assert.ok(second.startsWith('Reviewer note.'))
assert.ok(second.includes('[2]'))
assert.ok(!second.includes('[1]'))
console.log('October recovery replay, strict section parsing, inventory continuity, failure diagnostics, and freshness escalation passed.')
