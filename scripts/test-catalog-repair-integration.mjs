import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildRepairCandidate, REPAIR_OUTPUT_PATHS } from './lib/catalog-repair-candidate.mjs'
import { createRepairEvidence, canonicalJson, repairHash } from './lib/catalog-repair-evidence.mjs'
import { createSecurityReviewBaseline } from './lib/security-review-baselines.mjs'
import { projectRepairState, scopedRevert } from './lib/catalog-repair-feedback.mjs'

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const production = { reviewedData: await read('./data/reviewed-security-advisories.json'), baselines: await read('./data/security-review-baselines.json'), catalog: await read('../src/data/catalog.snapshot.json') }
const fixture = await read('./fixtures/catalog-repair/supported-semantics.json')
const trial = structuredClone(production), articleId = 'kb4857', baseCommit = 'a'.repeat(40)
// Pin this integration case to its independently reviewed source fixture rather
// than allowing future catalog updates to redefine the expected source evidence.
trial.reviewedData.observationSpecs[articleId].contentFingerprint = repairHash(fixture.informational.before)
trial.baselines.articles[articleId] = createSecurityReviewBaseline(articleId, fixture.informational.before, repairHash(fixture.informational.before))
const page = trial.catalog.securityFeedPageStates.find(item => item.articleId === articleId)
page.contentFingerprint = repairHash(fixture.informational.before)
const route = trial.catalog.securityFeedRoutes.find(item => item.articleId === articleId)
const report = { schemaVersion: 1, ok: false, error: { message: 'Reviewed source changed', report: { findings: [{ code: 'REVIEWED_ARTICLE_CONTENT_CHANGED', articleId }] } }, changes: [{ articleId, url: 'https://www.veeam.com/kb4857', before: fixture.informational.before, after: fixture.informational.after, acceptedPageState: page, acceptedRoute: route }] }
const args = { report, baseCommit, policy: trial.reviewedData, runId: '123', capturedAt: '2026-10-08T00:00:00.000Z' }
const bundle = createRepairEvidence({ ...args, environment: 'trial' })
assert.notEqual(bundle.evidenceId, createRepairEvidence(args).evidenceId, 'Trial identities cannot collide with production')
const proposal = { schemaVersion: 1, evidenceId: bundle.evidenceId, baseCommit, articles: [{ articleId, kind: 'informational', rationale: 'Only a known dependency version increased.', evidence: [{ sectionId: 'article', start: 0, end: fixture.informational.after.length, quote: fixture.informational.after }], unresolved: [] }] }
const before = canonicalJson(trial)
const result = buildRepairCandidate({ bundle, proposal, ...trial, currentCommit: baseCommit })
assert.equal(result.status, 'candidate-ready', JSON.stringify(result.blocked))
assert.equal(result.eligibleForPublication, false)
assert.equal(canonicalJson(trial), before)
const updated = { reviewedData: JSON.parse(result.files[REPAIR_OUTPUT_PATHS[0]]), baselines: JSON.parse(result.files[REPAIR_OUTPUT_PATHS[1]]), catalog: JSON.parse(result.files[REPAIR_OUTPUT_PATHS[2]]) }
assert.deepEqual(updated.catalog.securityFindings, trial.catalog.securityFindings, 'A dependency-note repair must not change public vulnerability findings')
assert.equal(updated.baselines.articles[articleId].normalizedText, fixture.informational.after)
assert.equal(updated.baselines.articles[articleId].reviewedFingerprint, updated.reviewedData.observationSpecs[articleId].contentFingerprint)
const reverted = scopedRevert({ current: updated, before: projectRepairState(trial, [articleId]), after: projectRepairState(updated, [articleId]), articleIds: [articleId] })
assert.deepEqual(projectRepairState(reverted, [articleId]), projectRepairState(trial, [articleId]))
assert.deepEqual(reverted.catalog.releases, production.catalog.releases)
assert.equal(buildRepairCandidate({ bundle, proposal, ...trial, currentCommit: baseCommit, holds: [articleId] }).status, 'blocked')
console.log('Integrated trial candidate and scoped-revert data checks passed; public findings remain unchanged.')
