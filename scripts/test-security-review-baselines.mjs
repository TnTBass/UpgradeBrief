import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSecurityReviewBaseline, normalizeSecurityReviewText, reconcileSecurityReviewBaselines, writeSecurityReviewReport } from './lib/security-review-baselines.mjs'
import { assertSecurityFeedCoverage, assertSecurityFeedPageStateContinuity, extractSecurityArticleScope, fingerprintSecurityArticleContent } from './lib/security-feed-coverage.mjs'
import { REVIEWED_SECURITY_CLASSIFICATIONS, REVIEWED_SECURITY_OBSERVATION_POLICY, normalizeReviewedSecurityMainArticle, observeReviewedSecurityArticle } from './lib/reviewed-security-advisories.mjs'

function scenario(id, before, after, scope = { productIds: ['vbr'], hasOutOfScopeProduct: true }) {
  const baseline = createSecurityReviewBaseline(id, before)
  const previous = { articleId: id, ...scope, contentFingerprint: baseline.contentFingerprint }
  const next = { ...previous, contentFingerprint: fingerprintSecurityArticleContent(after) }
  const input = { baselines: { schemaVersion: 1, articles: { [id]: baseline } }, previousStates: [previous], states: [next], texts: { [id]: after } }
  return { input, review: reconcileSecurityReviewBaselines(input), next }
}

const header = 'Reviewed article KB ID: 4924 Product: Veeam Backup & Replication Veeam Backup for AWS Published: 2026-09-09 Last Modified: 2026-09-09'
const before = `${header} Purpose Upgrade version 1.2 by 2026-10-01. Change the affected password.`
const renamed = before.replace('Veeam Backup for AWS', 'Veeam Plug-In for AWS').replace('Last Modified: 2026-09-09', 'Last Modified: 2026-09-23')
const safe = scenario('kb4924', before, renamed)
assert.deepEqual(safe.review.equivalentChanges, ['kb4924'])
assert.deepEqual(assertSecurityFeedPageStateContinuity(safe.review.continuityStates, [safe.next]), [safe.next])
assert.equal(safe.input.previousStates[0].contentFingerprint, fingerprintSecurityArticleContent(before), 'Must not mutate accepted snapshot state')

// Subsequent runs continue from the new raw fingerprint, with the same comparison fingerprint.
const repeat = reconcileSecurityReviewBaselines({ ...safe.input, baselines: safe.review.next, previousStates: [safe.next] })
assert.deepEqual(repeat.equivalentChanges, [])
assert.equal(repeat.next.articles.kb4924.contentFingerprint, safe.next.contentFingerprint)

for (const [id, oldName, newName, metadataOnly] of [
  ['kb4261', 'Veeam Plug-In for Microsoft Azure', 'Veeam Backup for Microsoft Azure', true],
  ['kb4374', 'Veeam Backup for Google Cloud', 'Veeam Plug-In for Google Cloud', false],
  ['kb4712', 'Veeam Backup for AWS', 'Veeam Plug-In for AWS', false],
  ['kb4712', 'Veeam Backup for Google Cloud', 'Veeam Plug-In for Google Cloud', false],
]) {
  const text = `Title KB ID: ${id.slice(2)} Product: ${oldName} Published: 2025-01-01 Last Modified: 2025-01-01 Purpose ${oldName} issue.`
  const replacement = metadataOnly ? text.replace(oldName, newName) : text.replaceAll(oldName, newName)
  assert.equal(normalizeSecurityReviewText(id, text), normalizeSecurityReviewText(id, replacement))
  if (metadataOnly) assert.notEqual(normalizeSecurityReviewText(id, text), normalizeSecurityReviewText(id, text.replaceAll(oldName, newName)))
}
assert.notEqual(normalizeSecurityReviewText('kb9999', before), normalizeSecurityReviewText('kb9999', renamed), 'No global naming equivalence')
assert.notEqual(normalizeSecurityReviewText('kb4924', before + ' Veeam Backup for AWS'), normalizeSecurityReviewText('kb4924', before + ' Veeam Plug-In for AWS'), 'AWS rule is metadata-only for KB4924')

for (const after of [
  renamed.replace('1.2', '1.3'),
  renamed.replace('2026-10-01', '2026-11-01'),
  renamed.replace('Change the affected password.', 'No password change is required.'),
  renamed + ' CVE-2026-12345',
  renamed + ' Severity: Critical',
  renamed.replace('Veeam Backup & Replication', 'Veeam ONE'),
  renamed.replace('Published: 2026-09-09', 'Published: 2026-09-10'),
  renamed.replace('Upgrade version', 'Do not upgrade version'),
]) {
  const changed = scenario('kb4924', before, after)
  assert.deepEqual(changed.review.equivalentChanges, [])
  assert.throws(() => assertSecurityFeedPageStateContinuity(changed.review.continuityStates, [changed.next]), /Security feed coverage failed/)
}

// Known naming differences never excuse product-scope changes or missing pages.
assert.throws(() => assertSecurityFeedPageStateContinuity(safe.review.continuityStates, [{ ...safe.next, productIds: ['veeam-one'] }]), /Security feed coverage failed/)
assert.throws(() => assertSecurityFeedPageStateContinuity(safe.review.continuityStates, []), /Security feed coverage failed/)
assert.throws(() => assertSecurityFeedPageStateContinuity(
  [{ ...safe.input.previousStates[0], observedCveIds: ['CVE-2026-10001'] }],
  [{ ...safe.next, observedCveIds: ['CVE-2026-10001', 'CVE-2026-10002'] }],
  { allowInventoryExpansion: false },
), /Security feed coverage failed/, 'Live refresh must review changed inventory text even when its CVE set expands')
for (const name of ['Veeam Plug-In for AWS', 'Veeam Plug-In for Google Cloud', 'Veeam Plug-In for Microsoft Azure']) {
  assert.equal(extractSecurityArticleScope(`<h1>${name}</h1><p>Security fix.</p>`).hasOutOfScopeProduct, true)
}

const missing = reconcileSecurityReviewBaselines({ ...safe.input, baselines: { schemaVersion: 1, articles: {} } })
assert.deepEqual(missing.equivalentChanges, [], 'A missing baseline cannot approve changed content')
assert.throws(() => assertSecurityFeedPageStateContinuity(missing.continuityStates, [safe.next]), /Security feed coverage failed/)
const corrupted = structuredClone(safe.input)
corrupted.baselines.articles.kb4924.normalizedText += ' hidden edit'
assert.throws(() => reconcileSecurityReviewBaselines(corrupted), /baseline is inconsistent/)
const mismatched = structuredClone(safe.input)
mismatched.previousStates[0].contentFingerprint = fingerprintSecurityArticleContent('another accepted source')
assert.throws(() => reconcileSecurityReviewBaselines(mismatched), /baseline is inconsistent/)

// Informational policies retain their independently reviewed fingerprint anchor.
const policyFingerprint = fingerprintSecurityArticleContent(before)
const policyInput = {
  ...safe.input,
  baselines: { schemaVersion: 1, articles: { kb4924: createSecurityReviewBaseline('kb4924', before, policyFingerprint) } },
  policies: { kb4924: { contentFingerprint: policyFingerprint } },
}
const policyReview = reconcileSecurityReviewBaselines(policyInput)
assert.equal(policyReview.acceptedFingerprints.kb4924, safe.next.contentFingerprint)
assert.throws(() => reconcileSecurityReviewBaselines({ ...policyInput, policies: { kb4924: { contentFingerprint: fingerprintSecurityArticleContent('unreviewed anchor') } } }), /baseline is inconsistent/)
assert.deepEqual(observeReviewedSecurityArticle('kb4924', renamed, { equivalentFingerprint: policyReview.acceptedFingerprints.kb4924 }).observedCves, [])
assert.throws(() => observeReviewedSecurityArticle('kb4924', renamed + ' CVE-2026-12345', { equivalentFingerprint: policyReview.acceptedFingerprints.kb4924 }), /changed/)
assert.equal(assertSecurityFeedCoverage({
  articles: [{ id: 'kb4924', type: 'security', url: '/kb4924', seoTitle: 'Veeam Backup & Replication', product: [{ title: 'Veeam Backup & Replication' }] }],
  classifications: { kb4924: { ...REVIEWED_SECURITY_CLASSIFICATIONS.kb4924, contentFingerprint: policyReview.acceptedFingerprints.kb4924 } },
  articlePages: { kb4924: { content: renamed, observedCves: [] } },
  parsedCoverage: [], catalog: { securityFindings: [] },
}).report.ok, true, 'Reconciled fingerprint must also pass the independent informational coverage gate')

// Existing extraction ignores page furniture, while new mitigation remains significant.
assert.equal(normalizeReviewedSecurityMainArticle('<nav>New navigation</nav><h1>Article</h1><p>Keep this guidance.</p>'), 'Article Keep this guidance.')

const directory = await mkdtemp(join(tmpdir(), 'security-review-test-'))
try {
  const after = renamed.replace('Change the affected password.', 'Rotate every affected password. <script>alert(1)</script>')
  const report = await writeSecurityReviewReport({
    directory, baselines: safe.input.baselines, texts: { kb4924: after },
    catalog: { securityFindings: [{ id: 'finding-1', sourceIds: ['kb4924'] }] },
    error: new Error('Changed source'), summaryPath: join(directory, 'summary.md'),
  })
  assert.equal(report.ok, false)
  assert.equal(report.changes[0].before, before)
  assert.equal(report.changes[0].after, after)
  assert.deepEqual(report.changes[0].affectedFindingIds, ['finding-1'])
  assert.match(report.changes[0].diff.after, /Rotate every affected password/)
  assert.equal(JSON.parse(await readFile(join(directory, 'review.json'), 'utf8')).changes[0].disposition, 'review-required')
  const markdown = await readFile(join(directory, 'review.md'), 'utf8')
  assert.match(markdown, /previous catalogue and accepted baselines are retained/)
  assert(!markdown.includes('<script>'), 'Vendor text must not inject HTML into review summaries')
  assert.equal(await readFile(join(directory, 'summary.md'), 'utf8'), markdown)
} finally {
  await rm(directory, { recursive: true, force: true })
}

// Every committed baseline must still match the catalogue and reviewed policy.
const persisted = JSON.parse(await readFile(new URL('./data/security-review-baselines.json', import.meta.url), 'utf8'))
const catalog = JSON.parse(await readFile(new URL('../src/data/catalog.snapshot.json', import.meta.url), 'utf8'))
const ids = new Set(Object.keys(persisted.articles))
reconcileSecurityReviewBaselines({ baselines: persisted, previousStates: catalog.securityFeedPageStates,
  states: catalog.securityFeedPageStates.filter(s => ids.has(s.articleId)),
  texts: Object.fromEntries(Object.entries(persisted.articles).map(([id, value]) => [id, value.normalizedText])), policies: REVIEWED_SECURITY_OBSERVATION_POLICY })
console.log('Security review baseline, equivalence, fail-closed, and report tests passed.')
