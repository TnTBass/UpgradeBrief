import { readFile } from 'node:fs/promises'
import {
  VspcReleaseSecurityObservationError,
  createVspcReleaseSecurityReviewFromParsedCves,
  extractVspcReleaseSecuritySections,
  mergeVspcReleaseSecurityArticles,
  observeVspcReleaseSecurityArticle,
  parseVspcReleaseSecurityArticle,
  parseVspcReleaseSecurityPages,
} from './lib/vspc-release-security.mjs'

const articles = {
  kb4223: { id: 'kb4223', type: 'article', url: '/kb4223', seoTitle: 'Veeam Service Provider Console v5 Patch 4' },
  kb4277: { id: 'kb4277', type: 'article', url: '/kb4277', seoTitle: 'Release Information for Veeam Service Provider Console v6 Patch 1' },
  kb4788: { id: 'kb4788', type: 'article', url: '/kb4788', seoTitle: 'Release History for Veeam Service Provider Console 9' },
}
const fixturePaths = {
  kb4223: '../src/data/fixtures/vspc-kb4223-release-security.fixture.html',
  kb4277: '../src/data/fixtures/vspc-kb4277-release-security.fixture.html',
  kb4788: '../src/data/fixtures/vspc-kb4788-release-security.fixture.html',
}
const fixtures = Object.fromEntries(await Promise.all(Object.entries(fixturePaths).map(async ([articleId, path]) =>
  [articleId, await readFile(new URL(path, import.meta.url), 'utf8')],
)))

const sectionCounts = { kb4223: 1, kb4277: 1, kb4788: 3 }
for (const [articleId, expectedCount] of Object.entries(sectionCounts)) {
  const sections = extractVspcReleaseSecuritySections(fixtures[articleId], articles[articleId])
  if (sections.length !== expectedCount) throw new Error(`${articleId} Security-section extraction was incomplete.`)
  const observation = observeVspcReleaseSecurityArticle(fixtures[articleId], articles[articleId])
  if (observation.sections.length !== expectedCount) throw new Error(`${articleId} reviewed Security-section observation was incomplete.`)
}

const kb4788Sections = extractVspcReleaseSecuritySections(fixtures.kb4788, articles.kb4788)
if (kb4788Sections.map((section) => section.key).join(',') !== [
  'kb4788:9.2.1.33875:resolved-issues',
  'kb4788:9.1.0.30713:new-features-and-enhancements',
  'kb4788:9.1.0.30713:resolved-issues',
].join(',')) throw new Error('KB4788 repeated Security sections lost their release or parent-section context.')

const pages = Object.keys(articles).map((articleId) => ({ article: articles[articleId], html: fixtures[articleId] }))
const parsedPages = parseVspcReleaseSecurityPages(pages)
if (parsedPages.advisories.length !== 3 || parsedPages.sources.length !== 3 || parsedPages.observations.flatMap((observation) => observation.sections).length !== 5) throw new Error('VSPC release security page parsing did not return complete advisories, sources, and observations.')

const [kb4223, kb4277, kb4788] = ['kb4223', 'kb4277', 'kb4788'].map((articleId) =>
  parseVspcReleaseSecurityArticle(fixtures[articleId], articles[articleId]),
)
if (kb4223.fixedBuild !== '5.0.0.7151' || kb4223.records.length !== 2 || kb4223.affectedBuildRanges[0].throughBuild !== '5.0.0.6959') throw new Error('KB4223 did not retain both Security findings and every known pre-fix VSPC 5 build.')
if (kb4277.fixedBuild !== '6.0.0.8787' || kb4277.records.length !== 1 || !kb4277.records[0].title.includes('tenants managed by other resellers')) throw new Error('KB4277 did not retain the cross-reseller repository-data exposure finding.')
if (kb4788.fixedBuild !== '9.1.0.30713'
  || kb4788.records.length !== 1
  || kb4788.affectedBuilds.join(',') !== '9.1.0.30345,9.1.0.30636'
  || kb4788.affectedBuildRanges
  || !kb4788.records[0].title.includes('privilege escalation for any authenticated user')) throw new Error('KB4788 did not isolate the authenticated web PowerShell privilege-escalation finding to the two earlier VSPC 9.1 builds.')
const records = parsedPages.advisories.flatMap((advisory) => advisory.records)
if (records.length !== 4 || records.some((record) => record.cves.length || Object.hasOwn(record, 'cvssScore'))) throw new Error('CVE-less release findings received an invented CVE or CVSS score.')

const unrelatedEdit = fixtures.kb4223.replace('an alarm returns incorrect duration values', 'a monitoring alarm returns an incorrect duration value')
observeVspcReleaseSecurityArticle(unrelatedEdit, articles.kb4223)

const changedSecurity = fixtures.kb4223.replace('download specific files from the server', 'download arbitrary files from the server')
let changedError
try {
  observeVspcReleaseSecurityArticle(changedSecurity, articles.kb4223)
} catch (error) {
  changedError = error
}
if (!(changedError instanceof VspcReleaseSecurityObservationError)
  || changedError.code !== 'VSPC_RELEASE_SECURITY_SECTION_CHANGED'
  || changedError.articleId !== 'kb4223'
  || changedError.issues[0]?.type !== 'changed-section'
  || !changedError.issues[0]?.observedItems?.[0]?.includes('arbitrary files')) {
  throw new Error('A changed reviewed Security section did not produce a structured fail-closed error.')
}

const unknownArticle = { id: 'kb4998', url: '/kb4998' }
const unknownWithoutSecurity = '<html><main><h1>Release notes</h1><h2>Resolved Issues</h2><h5>General</h5><ul><li>Routine fix.</li></ul></main></html>'
const quietObservation = observeVspcReleaseSecurityArticle(unknownWithoutSecurity, unknownArticle)
if (quietObservation.sections.length) throw new Error('An unrelated new article produced a false Security observation.')

const unknownWithSecurity = '<html><main><h1>Release notes</h1><h2>Resolved Issues</h2><h5>Security</h5><ul><li>A newly published access-control issue.</li></ul></main></html>'
let unexpectedError
try {
  observeVspcReleaseSecurityArticle(unknownWithSecurity, unknownArticle)
} catch (error) {
  unexpectedError = error
}
if (!(unexpectedError instanceof VspcReleaseSecurityObservationError)
  || unexpectedError.issues[0]?.type !== 'unexpected-section'
  || unexpectedError.issues[0]?.observedItems?.[0] !== 'A newly published access-control issue.') {
  throw new Error('A new unreviewed Security section did not fail closed with its evidence.')
}

const parsedCveArticle = { id: 'kb4999', url: '/kb4999' }
const parsedCveSecurity = '<html><main><h1>VSPC 10 Patch 1</h1><h3>10.0.1.100</h3><h4>Resolved Issues</h4><h5>Security</h5><ul><li>CVE-2027-10001 | A modeled server vulnerability.</li><li>CVE-2027-10002 | A second modeled server vulnerability.</li></ul><h5>General</h5><ul><li>Routine fix.</li></ul></main></html>'
const parsedCveAdvisory = {
  productId: 'vspc',
  source: { id: 'kb4999', title: 'Veeam KB4999', url: 'https://www.veeam.com/kb4999' },
  records: [{ cve: 'CVE-2027-10001' }, { cves: ['CVE-2027-10002'] }],
}
const dynamicReview = createVspcReleaseSecurityReviewFromParsedCves(parsedCveSecurity, parsedCveArticle, parsedCveAdvisory)
const dynamicallyObserved = parseVspcReleaseSecurityPages(
  [{ article: parsedCveArticle, html: parsedCveSecurity }],
  { reviewedArticles: dynamicReview },
)
if (dynamicallyObserved.observations[0]?.sections.length !== 1 || dynamicallyObserved.advisories.length !== 0) throw new Error('A newly parsed standard CVE Security section could not be dynamically reviewed without duplicating its advisory.')

const mixedSecurity = parsedCveSecurity.replace('</ul><h5>General</h5>', '</ul><p>A nearby access-control fix without a CVE.</p><h5>General</h5>')
let mixedError
try {
  createVspcReleaseSecurityReviewFromParsedCves(mixedSecurity, parsedCveArticle, parsedCveAdvisory)
} catch (error) {
  mixedError = error
}
if (!(mixedError instanceof VspcReleaseSecurityObservationError)
  || !mixedError.issues.some((issue) => issue.type === 'cve-less-item' && issue.observedItem.includes('without a CVE'))) {
  throw new Error('A mixed CVE and CVE-less Security section was incorrectly granted a dynamic review.')
}

let unmodeledCveError
try {
  createVspcReleaseSecurityReviewFromParsedCves(parsedCveSecurity, parsedCveArticle, { ...parsedCveAdvisory, records: [parsedCveAdvisory.records[0]] })
} catch (error) {
  unmodeledCveError = error
}
if (!(unmodeledCveError instanceof VspcReleaseSecurityObservationError)
  || !unmodeledCveError.issues.some((issue) => issue.type === 'unmodeled-cve' && issue.cve === 'CVE-2027-10002')) {
  throw new Error('An unmodeled CVE was incorrectly granted a dynamic review.')
}

const reviewedDuplicate = '<html><main><h1>VSPC patch</h1><h2>Resolved Issues</h2><h5>Security</h5><ul><li>Due to an unsafe deserialization method used by the Veeam Service Provider Console (VSPC) server in communication between the management agent and its components, under certain conditions, it is possible to achieve Remote Code Execution (RCE) on the VSPC server machine.</li></ul></main></html>'
observeVspcReleaseSecurityArticle(reviewedDuplicate, { id: 'kb4441', url: '/kb4441' })
let observationOnlyError
try {
  parseVspcReleaseSecurityArticle(reviewedDuplicate, { id: 'kb4441', url: '/kb4441' })
} catch (error) {
  observationOnlyError = error
}
if (!/observation-only/.test(observationOnlyError?.message ?? '')) throw new Error('A reviewed duplicate Security section was incorrectly parsed as a new finding.')

const base = {
  releases: [
    { id: 'vspc-build-5-0-0-7151', productId: 'vspc', aliases: ['5.0.0.7151'] },
    { id: 'vspc-build-6-0-0-8787', productId: 'vspc', aliases: ['6.0.0.8787'] },
    { id: 'vspc-build-9-1-0-30345', productId: 'vspc', aliases: ['9.1.0.30345'] },
    { id: 'vspc-9.1', productId: 'vspc', aliases: ['9.1', '9.1.0.30636'] },
    { id: 'vspc-build-9-1-0-30713', productId: 'vspc', aliases: ['9.1.0.30713'] },
  ],
  sources: [{ id: 'kb4223', title: 'Old title', url: 'https://www.veeam.com/kb4223', retainedMetadata: true }],
  securityFindings: [
    { id: 'old-kb4223', productId: 'vspc', sourceIds: ['kb4223'] },
    { id: 'keep-vspc', productId: 'vspc', sourceIds: ['kb4679'] },
    { id: 'keep-other-product', productId: 'vbr', sourceIds: ['kb4223'] },
  ],
}
const merged = mergeVspcReleaseSecurityArticles(base, parsedPages.advisories, { checkedAt: '2026-08-14T12:00:00.000Z' })
if (merged.findings !== 4 || merged.sources !== 3 || merged.catalog.securityFindings.length !== 6) throw new Error('VSPC CVE-less release findings were not merged with the expected scope.')
if (merged.catalog.securityFindings.some((finding) => finding.id === 'old-kb4223')
  || !merged.catalog.securityFindings.some((finding) => finding.id === 'keep-vspc')
  || !merged.catalog.securityFindings.some((finding) => finding.id === 'keep-other-product')) throw new Error('VSPC release merge removed findings outside its product/source scope.')
const generated = merged.catalog.securityFindings.filter((finding) => finding.id.startsWith('vspc-kb'))
if (generated.some((finding) => finding.cves.length || Object.hasOwn(finding, 'cvssScore'))
  || new Set(generated.map((finding) => finding.id)).size !== 4
  || generated.find((finding) => finding.id.includes('powershell'))?.fixedReleaseId !== 'vspc-build-9-1-0-30713'
  || generated.find((finding) => finding.id.includes('powershell'))?.affectedReleaseIds.join(',') !== 'vspc-build-9-1-0-30345,vspc-9.1') throw new Error('Merged VSPC CVE-less findings lost stable IDs, explicit affected releases, fixed releases, or CVE/CVSS integrity.')
const mergedKb4223Source = merged.catalog.sources.find((source) => source.id === 'kb4223')
if (!mergedKb4223Source.retainedMetadata || mergedKb4223Source.title === 'Old title' || mergedKb4223Source.checkedAt !== '2026-08-14T12:00:00.000Z') throw new Error('VSPC release source upsert did not preserve metadata and refresh official fields.')

console.log('VSPC CVE-less release Security adapter fixture test passed.')
