import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseComponentAdvisory, applyComponentChange, reviewedComponentScope } from './lib/component-advisory.mjs'
import { validateReviewedSecurityData } from './lib/reviewed-security-data.mjs'
import { createSecurityReviewBaseline, writeSecurityReviewReport } from './lib/security-review-baselines.mjs'
import { createRepairEvidence, classifyCatalogFailure, repairArticleIds } from './lib/catalog-repair-evidence.mjs'
import { buildRepairCandidate } from './lib/catalog-repair-candidate.mjs'
import { discoverArticleScopes } from './lib/catalog-discovery.mjs'
import { reconcileComponentScope } from './lib/component-review.mjs'
import { assertSecurityFeedPageStateContinuity } from './lib/security-feed-coverage.mjs'
import { publicationOutcome } from './lib/catalog-repair-outcome.mjs'
import { extractWithWorkersAi, makeAiRequest, validateReviewProposal } from './lib/catalog-repair-ai.mjs'
import { runTransactions } from './lib/catalog-refresh-isolation.mjs'
import { transactionClosure } from './lib/catalog-provenance.mjs'

const read = async p => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'))
const history = await read('./fixtures/catalog-repair/component-advisory-history.json')
const data = await read('./data/reviewed-security-advisories.json')
const catalog = await read('../src/data/catalog.snapshot.json')
const id = history.articleId
const clean = structuredClone(data)
clean.advisories = clean.advisories.filter(x => x.articleId !== id)
delete clean.observationSpecs[id]
const baseCommit = 'a'.repeat(40)
const scope = text => parseComponentAdvisory(id, text).model.productIds
function state(before, legacy = false) {
  const reviewedData = before ? applyComponentChange({ articleId: id, before: null, after: before }, clean).reviewedData : structuredClone(clean)
  if (legacy && before) delete reviewedData.observationSpecs[id].componentAdvisory
  const baseline = before && createSecurityReviewBaseline(id, before, reviewedData.observationSpecs[id].contentFingerprint)
  const page = before ? { articleId: id, productIds: scope(before), hasOutOfScopeProduct: true, contentFingerprint: baseline.contentFingerprint } : null
  const route = before ? { articleId: id, classification: 'dedicated', productIds: scope(before), multiProduct: true } : null
  return { reviewedData, baseline, page, route,
    baselines: { schemaVersion: 1, articles: before ? { [id]: baseline } : {} },
    catalog: { schemaVersion: 2, securityFeedRoutes: route ? [route] : [], securityFeedPageStates: page ? [page] : [] },
  }
}
function candidate(before, after, legacy = false) {
  const input = state(before, legacy)
  const report = { schemaVersion: 1, ok: false, error: { message: 'Source changed', report: { findings: [{ code: before ? 'UNKNOWN_SOURCE_SCOPE_CHANGE' : 'UNKNOWN_SOURCE_OWNERSHIP', articleId: id }] } },
    changes: [{ articleId: id, url: 'https://www.veeam.com/' + id, before, after, acceptedPageState: input.page, acceptedRoute: input.route }] }
  const bundle = createRepairEvidence({ report, policy: input.reviewedData, baseCommit, runId: '1', capturedAt: '2026-11-13T12:00:00Z' })
  const proposal = { schemaVersion: 1, baseCommit, evidenceId: bundle.evidenceId, articles: [{ articleId: id, kind: 'component', rationale: 'Recognized source facts', unresolved: [], evidence: [{ sectionId: 'article', start: 0, end: after.length, quote: after }] }] }
  return { ...input, bundle, proposal, result: buildRepairCandidate({ bundle, proposal, ...input, currentCommit: baseCommit }) }
}
for (const [label, before, after] of [
  ['November 7: new advisory', null, history.nov7],
  ['November 11: private fix available', history.nov7, history.nov11Morning],
  ['November 11: recovery media', history.nov11Morning, history.nov11Reviewed],
  ['November 13: new affected product', history.nov11Reviewed, history.nov13],
  ['November 13 live: worker update clarification', history.nov13, history.nov13Evening],
]) {
  const trial = candidate(before, after, true)
  assert.equal(trial.result.status, 'candidate-ready', label + JSON.stringify(trial.result.blocked))
  const next = JSON.parse(trial.result.files['scripts/data/reviewed-security-advisories.json'])
  validateReviewedSecurityData(next)
  assert.deepEqual(next.observationSpecs[id].componentAdvisory.productIds, scope(after))
  assert.ok(next.advisories.filter(a => a.articleId === id).every(a => a.fixedReleaseId === undefined))
  assert.deepEqual(Object.keys(trial.result.files), ['scripts/data/reviewed-security-advisories.json'], 'Accepted provenance is rebuilt live, never edited offline')
  assert.deepEqual(next.advisories.filter(a => a.articleId !== id), clean.advisories, 'Unrelated findings preserved')
}
for (const after of [
  history.nov13 + ' CVE-2099-99999',
  history.nov13.replace('Veeam Recovery Orchestrator 13.1 (embedded', 'Veeam Service Provider Console 13.1 (embedded'),
  history.nov13.replace('Yes, until the private fix is installed', 'No, not affected'),
  history.nov13.replace('13.1.2.57 as an embedded', '13.1.2.99 as an embedded'),
  history.nov13.replace('411259ED41BE5F0258452C3E6B5CD5FEC5511473EE2068EC558ACEB6EAA65BCB', 'A'.repeat(64)),
  history.nov13.replace('More Information', 'No private fix is required. More Information'),
  history.nov13.replaceAll('CVE-2026-98432', 'CVE-2099-99999'),
]) assert.equal(candidate(history.nov11Reviewed, after).result.status, 'blocked')
assert.equal(candidate(history.nov13, history.nov11Reviewed).result.status, 'blocked', 'Product coverage cannot disappear')
assert.equal(candidate(history.nov11Reviewed, history.nov7).result.status, 'blocked', 'Available patches cannot regress')
assert.equal(candidate(history.nov13Evening, history.nov13).result.status, 'blocked', 'Worker guidance cannot silently regress')
assert.equal(candidate(history.nov13, history.nov13Evening.replace('Workers automatically update on launch.', 'Workers do not automatically update on launch.')).result.status, 'blocked')
assert.equal(candidate(history.nov13, history.nov13Evening.replace('until the worker is next launched', 'until the kernel is updated')).result.status, 'blocked', 'Worker row and body must agree')
const latest = candidate(history.nov11Reviewed, history.nov13, true)
const next = JSON.parse(latest.result.files['scripts/data/reviewed-security-advisories.json'])
const policy = next.observationSpecs[id]
assert.equal(reviewedComponentScope({ articleId: id, text: history.nov13, previousText: history.nov11Reviewed, policy: { ...policy, contentFingerprint: latest.baseline.contentFingerprint } }), null)
assert.equal(reviewedComponentScope({ articleId: id, text: history.nov13, previousText: history.nov11Reviewed, policy: { ...policy, componentAdvisory: undefined } }), null)
const reconciled = reconcileComponentScope({ routes: latest.catalog.securityFeedRoutes, pageStates: latest.catalog.securityFeedPageStates, baselines: latest.baselines, texts: { [id]: history.nov13 }, policies: { [id]: policy } })
assert.deepEqual(reconciled.pageStates[0].productIds, ['vbr', 'vro'])
assert.deepEqual(latest.page.productIds, ['vbr'], 'Scope review does not mutate accepted state')
assert.throws(() => assertSecurityFeedPageStateContinuity(reconciled.pageStates, [{ ...reconciled.pageStates[0], productIds: ['vbr','vspc'] }]), /coverage failed/)
for (const mutate of [
  s => { s.componentAdvisory.extra = true },
  s => { s.componentAdvisory.privateFixes[1].prerequisiteBuild = '13.1.2.57' },
  s => { s.componentAdvisory.orchestrator.embeddedBuild = '13.1.2.99' },
  s => { s.productCves.vro = [] },
]) { const invalid = structuredClone(next); mutate(invalid.observationSpecs[id]); assert.throws(() => validateReviewedSecurityData(invalid)) }

const legacyError = { message: 'UNKNOWN_SOURCE_SCOPE_CHANGE: kb4966', code: 'UNKNOWN_SOURCE_SCOPE_CHANGE' }
assert.deepEqual(classifyCatalogFailure(legacyError).categories, ['article-classification'])
assert.deepEqual(repairArticleIds({ articles: [], failure: legacyError }), ['kb4966'])
const classified = [{ articleId: id, productIds: ['vbr'], classification: 'dedicated', multiProduct: true }, { articleId: 'kb9999', productIds: ['vspc'], classification: 'parsed', multiProduct: false }]
const discoveryCurrent = { ...latest.catalog, sourceOwnership: { [id]: ['vbr'] } }
async function discover(text, approved = false) {
  const reviewTexts = {}
  const collector = { forProducts: () => ({ request: async (_, options) => {
    if (options.sourceId === 'kb9999') await new Promise(resolve => setTimeout(resolve, 15))
    return new Response(options.sourceId === id ? text : 'Veeam Service Provider Console source.')
  } }) }
  const result = await discoverArticleScopes({ classified: approved ? classified.map(a => a.articleId === id ? { ...a, productIds: ['vbr','vro'] } : a) : classified, articles: classified.map(a => ({ id:a.articleId, url:'/'+a.articleId })), current:discoveryCurrent,
    baselines:latest.baselines, collector, policies: approved ? { [id]: policy } : {}, reviewTexts, productIds: catalog.products.map(p => p.id) })
  return { ...result, reviewTexts }
}
const discovered = await discover(history.nov13)
assert.deepEqual(discovered.blocked[0].productIds, ['vbr','vro'])
assert.ok(discovered.reviewTexts.kb9999, 'Other source collection settles before the failure report')
assert.equal((await discover(history.nov13, true)).blocked.length, 0)
await assert.rejects(discover(history.nov13.replaceAll('Veeam Recovery Orchestrator', 'Veeam Service Provider Console')), error =>
  error.articleIds.includes(id) && error.report.findings.some(f => f.articleId === id && f.observedScope.productIds.includes('vspc')))
const directory = await mkdtemp(join(tmpdir(), 'component-report-'))
try {
  const report = await writeSecurityReviewReport({ directory, baselines: { schemaVersion: 1, articles: {} }, texts: { [id]: history.nov7 }, catalog: { securityFindings: [], securityFeedRoutes: [], securityFeedPageStates: [] },
    error: Object.assign(new Error('New source'), { code: 'UNKNOWN_SOURCE_OWNERSHIP', report: { findings: [{ code:'UNKNOWN_SOURCE_OWNERSHIP', articleId:id }] } }) })
  assert.equal(report.changes[0].disposition, 'new-source-review')
  assert.equal(report.changes[0].after, history.nov7)
} finally { await rm(directory, {recursive:true,force:true}) }
const partial = await runTransactions({ current: catalog, baselines: {schemaVersion:1, articles:{}}, collector:{observations:new Map(),usage:new Map(),forProducts:()=>({})},
  policyHash:catalog.refreshPolicyHash, groups:transactionClosure(discovered.edges), discovery:{blocked:discovered.blocked}, shadow:false,
  build:async ({current})=>({catalog:current,baselines:{schemaVersion:1,articles:{}}}) })
assert.equal(partial.report.status, 'partial')
for (const p of partial.catalog.productValidation) {
  if (['vb365','vspc'].includes(p.productId)) assert.equal(p.state,'validated')
  else { assert.equal(p.state,'retained'); assert.equal(p.validatedAt,catalog.productValidation.find(x=>x.productId===p.productId).validatedAt) }
}
const review = {kind:'review',summary:'Requires review',claims:[{field:'patch',quote:'Install the private fix',interpretation:'A separate patch is required.'}],unresolved:[]}
validateReviewProposal(review,history.nov13)
assert.throws(()=>validateReviewProposal({...review,claims:[{...review.claims[0],quote:'Invented evidence'}]},history.nov13))
assert.equal(makeAiRequest('Install the private fix',{mode:'review'}).body.response_format.json_schema.properties.kind.enum[0],'review')
assert.equal(publicationOutcome({state:'needs-investigation'}).outcome,'needs-review')
assert.equal(publicationOutcome({state:'applied-awaiting-review'}).publicationVerified,false)
const published={state:'applied-awaiting-review',mergeCommit:'a'.repeat(40),catalogHash:'b'.repeat(64),deployment:{commit:'a'.repeat(40),catalogHash:'b'.repeat(64)}}
assert.equal(publicationOutcome(published).outcome,'recovered')
assert.equal(publicationOutcome({...published,deployment:{...published.deployment,catalogHash:'c'.repeat(64)}}).publicationVerified,false)
const newTexts = {}
const newDiscovery = await discoverArticleScopes({
  classified: [{ articleId:id, productIds:['vbr'], classification:'unclassified', multiProduct:true }],
  articles:[{id,url:'/'+id}], current:{securityFeedRoutes:[],securityFeedPageStates:[],sourceOwnership:{}},
  baselines:{schemaVersion:1,articles:{}}, policies:{}, reviewTexts:newTexts, productIds:catalog.products.map(p=>p.id),
  collector:{forProducts:()=>({request:async()=>new Response(history.nov7)})},
})
assert.equal(newTexts[id],history.nov7)
assert.deepEqual(newDiscovery.blocked[0].productIds,catalog.products.map(p=>p.id),'New source onboarding validates every product')
let reviewBudget={schemaVersion:1,reservations:[]}, reviewCalls=0
const reviewArgs={excerpt:'Install the private fix',mode:'review',accountId:'a'.repeat(32),token:'test-only',
  cacheKey:{evidenceId:'test-review'},loadState:async()=>reviewBudget,saveState:async value=>{reviewBudget=value},
  fetchImpl:async(_,options)=>{reviewCalls++; assert.equal(JSON.parse(options.body).response_format.json_schema.properties.kind.enum[0],'review')
    return new Response(JSON.stringify({success:true,result:{response:review}}),{status:200})},
}
assert.equal((await extractWithWorkersAi(reviewArgs)).extraction.kind,'review')
assert.equal((await extractWithWorkersAi(reviewArgs)).cached,true)
assert.equal(reviewCalls,1,'Review inference uses the same durable budget and cache controls')
console.log('Component incident replay, unsafe transitions, evidence capture, isolation, AI review and publication outcome checks passed.')

