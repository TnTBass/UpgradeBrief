import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { applyComponentChange, parseComponentAdvisory } from './lib/component-advisory.mjs'
import { validateReviewedSecurityData } from './lib/reviewed-security-data.mjs'
import { createSecurityReviewBaseline } from './lib/security-review-baselines.mjs'
import { createRepairEvidence } from './lib/catalog-repair-evidence.mjs'
import { buildRepairCandidate } from './lib/catalog-repair-candidate.mjs'
import { makeAiRequest } from './lib/catalog-repair-ai.mjs'
import { planReviewExcerpts, reviewWithWorkersAi } from './lib/catalog-repair-review.mjs'

const read = async p => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'))
const incident = await read('./fixtures/catalog-repair/2026-11-19-kb4966.json')
const article = incident.bundle.articles[0]
const currentData = await read('./data/reviewed-security-advisories.json')
const clean = structuredClone(currentData)
clean.advisories = clean.advisories.filter(a => a.articleId !== article.articleId)
delete clean.observationSpecs[article.articleId]
const beforeData = applyComponentChange({ ...article, before:null, after:article.before }, clean).reviewedData
const parsed = parseComponentAdvisory(article.articleId, article.after)
assert.ok(parsed)
assert.ok(parsed.quotes.length > 6 && parsed.quotes.every(q => article.after.includes(q)), 'Every extracted quote comes from original source, never normalization')
assert.deepEqual(parsed.model.redeployment, { applianceVersion:'13.1.2.57', upgradeMarkerVersion:'13.1.2.56', azureHelpers:'redeploy-or-vendor-script', cloudConnect:'private-fix-upgrade-or-redeploy' })
const repair = applyComponentChange(article, beforeData)
validateReviewedSecurityData(repair.reviewedData)
const oldVbr = beforeData.advisories.find(a => a.articleId === article.articleId && a.productId === 'vbr')
const newVbr = repair.reviewedData.advisories.find(a => a.articleId === article.articleId && a.productId === 'vbr')
assert.deepEqual({ ...newVbr, remediation:oldVbr.remediation }, oldVbr)
assert.match(newVbr.remediation, /provider and tenant network extension appliances/)
assert.match(newVbr.remediation, /repacked ISO with the integrated fix require no further network-extension action/)
assert.equal(newVbr.fixedReleaseId, undefined)
assert.deepEqual(repair.reviewedData.advisories.filter(a => a.productId !== 'vbr' || a.articleId !== article.articleId),
  beforeData.advisories.filter(a => a.productId !== 'vbr' || a.articleId !== article.articleId))
for (const mutate of [
  text => text.replace('WHERE "appliance_version" =', 'WHERE "appliance_version" !='),
  text => text.replace('13.1.2.56', '13.1.2.55'),
  text => text.replace('no further action is required', 'the private fix is not required'),
  text => text.replace('Upgrade or redeploy the network extension appliances', 'No network extension action is required'),
  text => text.replace('The script changes only helper appliances recorded with version 13.1.2.57.', ''),
  text => text.replace('Tenants that do not have network extension appliances deployed do not require action.', ''),
  text => text.replace('COMMIT ; Copy', 'COMMIT ; DELETE ALL DATA ; Copy'),
]) assert.equal(applyComponentChange({ ...article, after:mutate(article.after) }, beforeData), null)
assert.equal(applyComponentChange({ ...article, before:article.after, after:article.before }, repair.reviewedData), null, 'New remediation cannot disappear')
const invalid = structuredClone(repair.reviewedData)
invalid.observationSpecs.kb4966.componentAdvisory.redeployment.upgradeMarkerVersion = '13.1.2.55'
assert.throws(() => validateReviewedSecurityData(invalid))
const baselines = {schemaVersion:1, articles:{[article.articleId]:createSecurityReviewBaseline(article.articleId, article.before, article.beforeHash)}}
const catalog = {schemaVersion:2, securityFeedRoutes:[article.acceptedRoute],securityFeedPageStates:[article.acceptedPageState]}
const report = {schemaVersion:1,ok:false,error:incident.bundle.failure,changes:[article]}
const bundle = createRepairEvidence({report,policy:beforeData,baseCommit:incident.bundle.baseCommit,runId:incident.bundle.runId,capturedAt:incident.bundle.capturedAt})
const proposal = {schemaVersion:1,evidenceId:bundle.evidenceId,baseCommit:bundle.baseCommit,articles:[{articleId:article.articleId,kind:'component',rationale:'Reviewed component redeployment guidance',unresolved:[],evidence:[{sectionId:'article',start:0,end:article.after.length,quote:article.after}]}]}
const candidate = buildRepairCandidate({bundle,proposal,reviewedData:beforeData,baselines,catalog,currentCommit:bundle.baseCommit})
assert.equal(candidate.status,'candidate-ready',JSON.stringify(candidate.blocked))
assert.deepEqual(Object.keys(candidate.files),['scripts/data/reviewed-security-advisories.json'])

assert.throws(() => makeAiRequest(article.after,{mode:'review'}), /token budget/)
const planned = planReviewExcerpts(article.after)
assert.equal(planned.length,3)
assert.equal(planned[0].start,0)
assert.equal(planned.at(-1).end,article.after.length)
for(const [i,p] of planned.entries()){
  assert.ok(p.excerpt.includes(article.after.slice(p.start,p.end)))
  assert.ok(makeAiRequest(p.excerpt,{mode:'review'}).inputTokenUpperBound <= 8000)
  if(i)assert.ok(p.start < planned[i-1].end && p.end > planned[i-1].end)
}
let state={schemaVersion:1,reservations:[]}, calls=0
const response = {kind:'review',summary:'Component guidance requires review',claims:[{field:'other',quote:'CVE-2026-98432',interpretation:'The advisory concerns this CVE.'}],unresolved:[]}
const options = {text:article.after,accountId:'a'.repeat(32),token:'test-only',cacheKey:{test:'nov19'},
  loadState:async()=>state,saveState:async next=>{state=next},now:()=>new Date('2026-11-19T12:00:00Z'),
  fetchImpl:async()=>{calls++;return new Response(JSON.stringify({success:true,result:{response}}))}}
const complete = await reviewWithWorkersAi(options)
assert.equal(complete.complete,true)
assert.equal(complete.parts.length,3)
assert.equal(calls,3)
assert.equal(state.reservations.length,3)
assert.equal((await reviewWithWorkersAi(options)).complete,true)
assert.equal(calls,3,'All section proposals reuse durable cache')
let partialState={schemaVersion:1,reservations:[]}, attempts=0
const partial=await reviewWithWorkersAi({...options,loadState:async()=>partialState,saveState:async next=>{partialState=next},
  fetchImpl:async()=>++attempts===1?new Response(JSON.stringify({success:true,result:{response}})):new Response('refused',{status:400})})
assert.equal(partial.complete,false)
assert.equal(partial.parts.length,1,'Completed review evidence survives a later provider failure')
assert.equal(partial.plannedParts,3)
assert.match(partial.unresolved[0],/section 2 of 3/)
const beforeCalls=calls
await assert.rejects(reviewWithWorkersAi({...options,text:article.after.repeat(5)}),/three bounded sections/)
assert.equal(calls,beforeCalls,'Oversized review is rejected before spending budget')
assert.equal(buildRepairCandidate({bundle,proposal:{...proposal,articles:[{...proposal.articles[0],kind:'classification',unresolved:['Unknown semantic change']}]},
  reviewedData:beforeData,baselines,catalog,currentCommit:bundle.baseCommit,extractions:{[article.articleId]:complete}}).status,'blocked','AI section reviews cannot authorize publication')
console.log('November 19 evidence replay, guarded redeployment guidance and bounded complete AI review checks passed.')
