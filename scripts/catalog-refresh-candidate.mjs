import { mergeVbrBuilds, parseVbrBuilds } from './lib/vbr-builds.mjs'
import { mergeEnterpriseManagerBuilds } from './lib/enterprise-manager-builds.mjs'
import { mergeProductBuilds, parseProductBuilds } from './lib/product-builds.mjs'
import { mergeVb365Builds, parseVb365Builds } from './lib/vb365-builds.mjs'
import { mergeVb365UpgradePaths, parseVb365UpgradePaths } from './lib/vb365-upgrade-paths.mjs'
import { mergeVbrUpgradePaths, parseVbrUpgradePaths } from './lib/vbr-upgrade-paths.mjs'
import { mergeVbrSecurityBulletin, mergeVeeamOneSecurityBulletin, mergeVspcSecurityBulletin, parseVbrSecurityBulletin, parseVeeamOneSecurityBulletin, parseVspcSecurityBulletin } from './lib/vbr-security.mjs'
import { mergeProductReleaseSecurityArticles, parseProductReleaseSecurityArticle, parseVbrReleaseSecurityArticle } from './lib/vbr-release-security.mjs'
import { mergeVeeamOneLegacySecurityArticles, parseVeeamOneLegacySecurityArticle, selectVeeamOneLegacySecurityArticles } from './lib/veeam-one-legacy-security.mjs'
import { mergeVspcLegacySecurityArticles, parseVspcLegacySecurityArticle, selectVspcLegacySecurityArticles } from './lib/vspc-legacy-security.mjs'
import { mergeCisaKev, parseCisaKev } from './lib/cisa-kev.mjs'
import { mergeLifecyclePolicies, parseLifecyclePolicies } from './lib/lifecycle.mjs'
import { mergeVbrReleaseInformation, parseVbrReleaseInformation } from './lib/vbr-release-information.mjs'
import { contentFingerprint, extractSourceSupportedHighlights, mergeReleaseMaterials, mergeSourceSupportedHighlights, textFromDocument } from './lib/release-materials.mjs'
import { discoverReleaseMaterials } from './lib/release-material-discovery.mjs'
import { reconcileSecurityReviewBaselines } from './lib/security-review-baselines.mjs'
import { SecurityFeedCoverageError, assertSecurityFeedContinuity, assertSecurityFeedCoverage, assertSecurityFeedPageStateContinuity, assertSecurityFeedRouteContinuity, buildSecurityArticleClassifications, classifySecurityFeedArticles, extractCveIds, extractSecurityArticleScope, fetchSecurityFeedPages, fingerprintSecurityArticleContent, splitSecurityArticleVulnerabilityContent } from './lib/security-feed-coverage.mjs'
import { REVIEWED_SECURITY_PARSED_COVERAGE, REVIEWED_SECURITY_OBSERVATION_POLICY, mergeReviewedSecurityAdvisories, normalizeReviewedSecurityMainArticle, observeReviewedSecurityArticle } from './lib/reviewed-security-advisories.mjs'
import { VSPC_REVIEWED_CVE_EXCLUSIONS, VspcKbCveCoverageError, assertVspcKbCveCoverage, fetchVspcKbInventory, fingerprintVspcParsedModel, inspectVspcKbCveCoverage } from './lib/vspc-kb-cve-coverage.mjs'
import { VspcCveRecordCoverageError, assertVspcCveRecordCoverage, fetchVspcCveRecords } from './lib/vspc-cve-record-coverage.mjs'
import { createVspcReleaseSecurityReviewFromParsedCves, extractVspcReleaseSecuritySections, mergeVspcReleaseSecurityArticles, parseVspcReleaseSecurityPages } from './lib/vspc-release-security.mjs'
import { hasSectionedSecurityLayout } from './lib/sectioned-security.mjs'
import { unreviewedTrailingCveIds } from './lib/reviewed-mitigation-references.mjs'

import { pinnedSecurityArticles, securityClassificationOverrides } from './lib/catalog-refresh-registry.mjs'

export async function buildCatalogCandidate({ current: accepted, baselines, sourceFetcher, productIds, refreshedAt, reviewTexts = {} }) {
const current = structuredClone(accepted)
const owns = productId => productIds.includes(productId)
const fetchFor = (productId, source) => owns(productId) ? fetchSource(source) : undefined
let baselineReview
const buildSource = current.sources.find((item) => item.id === 'kb2680')
const oneBuildSource = current.sources.find((item) => item.id === 'kb4357')
const vroBuildSource = current.sources.find((item) => item.id === 'kb4358')
const vspcBuildSource = current.sources.find((item) => item.id === 'kb4464')
const vb365BuildSource = current.sources.find((item) => item.id === 'kb4106')
const vb365UpgradeSource = current.sources.find((item) => item.id === 'kb4098')
const vbrUpgradeSource = current.sources.find((item) => item.id === 'kb2053')
const securitySource = current.sources.find((item) => item.id === 'kb4649')
const securityFeedSource = current.sources.find((item) => item.id === 'security-kb')
const kevSource = current.sources.find((item) => item.id === 'cisa-kev')
const lifecycleSource = current.sources.find((item) => item.id === 'lifecycle')
const releaseInformationSource = current.sources.find((item) => item.id === 'kb4696')
const releaseInformation13Source = current.sources.find((item) => item.id === 'kb4738')
if (!buildSource || !oneBuildSource || !vroBuildSource || !vspcBuildSource || !vb365BuildSource || !vb365UpgradeSource || !vbrUpgradeSource || !securitySource || !securityFeedSource || !kevSource || !lifecycleSource || !releaseInformationSource || !releaseInformation13Source) throw new Error('A required catalog source is missing from the catalog.')
console.log('[catalog-refresh] Fetching build lists, security inventories, and lifecycle sources.')

const securityProducts = {
  vbr: 'Veeam Backup & Replication',
  'enterprise-manager': 'Veeam Backup Enterprise Manager',
  'veeam-one': 'Veeam ONE',
  vro: 'Veeam Recovery Orchestrator',
  vspc: 'Veeam Service Provider Console',
  vb365: 'Veeam Backup for Microsoft 365',
}
async function fetchSource(source) {
  const response = await sourceFetcher.request(source.url, { sourceId: source.id })
  return response.text()
}

async function fetchDocument(url, sourceId) {
  const response = await sourceFetcher.request(url, { sourceId })
  return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? '' }
}

const releaseMaterialProducts = [
  { productId: 'vbr', helpCenterProductId: '8', productTitle: 'Veeam Backup & Replication' },
  { productId: 'veeam-one', helpCenterProductId: '9', productTitle: 'Veeam ONE' },
  { productId: 'vro', helpCenterProductId: '51', productTitle: 'Veeam Recovery Orchestrator' },
  { productId: 'vspc', helpCenterProductId: '49', productTitle: 'Veeam Service Provider Console' },
  { productId: 'vb365', helpCenterProductId: '36', productTitle: 'Veeam Backup for Microsoft 365' },
]
const selectedReleaseMaterialProducts = releaseMaterialProducts.filter(product => owns(product.productId))
const releaseMaterialEndpoint = 'https://helpcenter.veeam.com/services/component/technical_documentation_table/select'

const [buildHtml, oneBuildHtml, vroBuildHtml, vspcBuildHtml, vb365BuildHtml, vb365UpgradeHtml, kevPayload, lifecycleHtml, releaseInformationHtml, releaseInformation13Html] = await Promise.all([fetchFor('vbr', buildSource), fetchFor('veeam-one', oneBuildSource), fetchFor('vro', vroBuildSource), fetchFor('vspc', vspcBuildSource), fetchFor('vb365', vb365BuildSource), fetchFor('vb365', vb365UpgradeSource), fetchSource(kevSource), fetchSource(lifecycleSource), fetchFor('vbr', releaseInformationSource), fetchFor('vbr', releaseInformation13Source)])
const securityFeed = await fetchSecurityFeedPages({
  minimumArticleCount: 46,
  fetchPage: ({ offset, limit }) => fetchSource({
    id: `security-kb-${offset}`,
    url: `https://www.veeam.com/services/kb-articles?${new URLSearchParams({ type: 'security', offset: String(offset), limit: String(limit) })}`,
  }),
})
const vspcKbInventory = owns('vspc') ? await fetchVspcKbInventory({
  minimumArticleCount: 69,
  fetchPage: ({ offset, limit }) => fetchSource({
    id: `vspc-kb-inventory-${offset}`,
    url: `https://www.veeam.com/services/kb-articles?${new URLSearchParams({ product: 'VAC', offset: String(offset), limit: String(limit) })}`,
  }),
}) : { articles: [] }
const securityFeedArticleIds = assertSecurityFeedContinuity(current.securityFeedArticleIds, securityFeed.articles)
const securityArticles = [...securityFeed.articles, ...pinnedSecurityArticles.filter((pinned) => !securityFeed.articles.some((article) => article.id.toLowerCase() === pinned.id))]
const securityClassifications = buildSecurityArticleClassifications(securityArticles, securityClassificationOverrides)
const classifiedSecurityArticles = classifySecurityFeedArticles({ articles: securityArticles, classifications: securityClassifications })
const securityFeedArticleIdSet = new Set(securityFeed.articles.map((article) => article.id.toLowerCase()))
const securityFeedRoutes = assertSecurityFeedRouteContinuity(current.securityFeedRoutes, classifiedSecurityArticles
  .filter((article) => securityFeedArticleIdSet.has(article.articleId))
  .map(({ articleId, classification, productIds, multiProduct }) => ({ articleId, classification, productIds, multiProduct })))
const sourceArticleById = new Map(securityArticles.map((article) => [article.id.toLowerCase(), article]))
// Fetch new articles for review evidence; the coverage gate still rejects unclassified articles.
const classifiedArticlesToFetch = classifiedSecurityArticles.filter(article => !article.productIds.length || article.productIds.some(owns))
const selectedArticleIds = new Set(classifiedArticlesToFetch.map(article => article.articleId))
const previousPageStates = current.securityFeedPageStates.filter(state => selectedArticleIds.has(state.articleId))
console.log(`[catalog-refresh] Fetching ${classifiedArticlesToFetch.length} security articles and ${vspcKbInventory.articles.length} VSPC inventory pages with source throttling.`)
const classifiedArticleResponses = await Promise.allSettled(classifiedArticlesToFetch.map(async (article) => ({
    article,
    html: await fetchSource({ id: article.articleId, url: new URL(sourceArticleById.get(article.articleId).url, 'https://www.veeam.com').toString() }),
})))
const articleResponseById = new Map(classifiedArticleResponses.map((response, index) => [classifiedArticlesToFetch[index].articleId, response]))
const vspcKbPageResponses = await Promise.allSettled(vspcKbInventory.articles.map(async (article) => {
  const securityResponse = articleResponseById.get(article.id)
  if (securityResponse?.status === 'fulfilled') return securityResponse.value.html
  if (securityResponse?.status === 'rejected') throw securityResponse.reason
  return fetchSource({ id: `vspc-kb-page-${article.id}`, url: new URL(article.url, 'https://www.veeam.com').toString() })
}))
const vspcKbPages = Object.fromEntries(vspcKbInventory.articles.map((article, index) => {
  const response = vspcKbPageResponses[index]
  return [article.id, response.status === 'fulfilled' ? { html: response.value } : { error: response.reason?.message ?? 'fetch failed' }]
}))
const preliminaryVspcKbCoverage = inspectVspcKbCveCoverage({
  articles: vspcKbInventory.articles,
  pages: vspcKbPages,
  catalog: current,
})
const observedVspcCveIds = [...new Set(preliminaryVspcKbCoverage.pageStates.flatMap((state) => {
  const excluded = new Set(VSPC_REVIEWED_CVE_EXCLUSIONS[state.articleId]?.cveIds ?? [])
  return state.observedCveIds.filter((cve) => !excluded.has(cve))
}))].sort()
const fetchedSecurityFeedPageStates = classifiedArticlesToFetch.flatMap((article) => {
  const response = articleResponseById.get(article.articleId)
  if (response.status !== 'fulfilled') return []
  const scope = extractSecurityArticleScope(response.value.html)
  const normalizedContent = normalizeReviewedSecurityMainArticle(response.value.html)
  reviewTexts[article.articleId] = normalizedContent
  const fingerprinted = ['dedicated', 'inventory', 'informational', 'out-of-scope'].includes(article.classification)
  return [{
    articleId: article.articleId,
    productIds: scope.productIds,
    hasOutOfScopeProduct: scope.hasOutOfScopeProduct,
    ...(fingerprinted ? { contentFingerprint: fingerprintSecurityArticleContent(normalizedContent) } : {}),
    ...(article.classification === 'inventory' ? { observedCveIds: extractCveIds(normalizedContent) } : {}),
  }]
})
baselineReview = reconcileSecurityReviewBaselines({
  baselines, previousStates: previousPageStates, states: fetchedSecurityFeedPageStates,
  texts: reviewTexts, policies: REVIEWED_SECURITY_OBSERVATION_POLICY, allowReviewedPolicyTransition: current.schemaVersion === 2,
})
const securityFeedPageStates = assertSecurityFeedPageStateContinuity(baselineReview.continuityStates, fetchedSecurityFeedPageStates, { allowInventoryExpansion: false })
for (const [articleId, contentFingerprint] of Object.entries(baselineReview.acceptedFingerprints)) {
  if (securityClassifications[articleId]?.classification === 'informational') securityClassifications[articleId] = { ...securityClassifications[articleId], contentFingerprint }
}
const securityArticlePages = Object.fromEntries(classifiedArticlesToFetch.map((article) => {
  const response = articleResponseById.get(article.articleId)
  if (response.status !== 'fulfilled') return [article.articleId, response]
  const html = response.value.html
  if (!REVIEWED_SECURITY_OBSERVATION_POLICY[article.articleId]) {
    const section = hasSectionedSecurityLayout(html)
      ? { vulnerabilityContent: normalizeReviewedSecurityMainArticle(html), trailingContent: '' }
      : splitSecurityArticleVulnerabilityContent(html)
    const scope = extractSecurityArticleScope(section.vulnerabilityContent)
    return [article.articleId, {
      html: section.vulnerabilityContent,
      trailingCveIds: unreviewedTrailingCveIds(article.articleId, html, extractCveIds(section.trailingContent)),
      observedProductIds: scope.productIds,
      observedOutOfScopeProduct: scope.hasOutOfScopeProduct,
    }]
  }
  const observation = observeReviewedSecurityArticle(article.articleId, html, { equivalentFingerprint: baselineReview.acceptedFingerprints[article.articleId] })
  return [article.articleId, article.classification === 'informational'
    ? { content: normalizeReviewedSecurityMainArticle(html), observedCves: observation.observedCves }
    : { html, ...observation }]
}))
const discoveredReleaseMaterials = (await Promise.all(selectedReleaseMaterialProducts.map(product => discoverReleaseMaterials({
  product,
  fetchPayload: async () => JSON.parse(await fetchSource({
    id: `release-materials-${product.productId}`,
    url: `${releaseMaterialEndpoint}?${new URLSearchParams({ productId: product.helpCenterProductId, localeCode: 'en', isInitial: 'true' })}`,
  })),
})))).flat()
console.log(`[catalog-refresh] Source continuity passed; fetching ${discoveredReleaseMaterials.length} release documents.`)
if (!selectedReleaseMaterialProducts.every((product) => discoveredReleaseMaterials.some((material) => material.productId === product.productId))) throw new Error('Help Center release-material discovery returned no current document for one or more tracked products.')
const releaseMaterialDocuments = await Promise.allSettled(discoveredReleaseMaterials.map(async (material) => {
  const document = await fetchDocument(material.url, `release-material-${material.productId}-${material.releaseFamily}-${material.kind}`)
  const contentHash = contentFingerprint(document.bytes)
  let text
  try { text = await textFromDocument(document.bytes, document.contentType, material.url) } catch { text = undefined }
  return { ...material, contentHash, text }
}))
const fetchedReleaseMaterials = releaseMaterialDocuments.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
if (fetchedReleaseMaterials.length !== discoveredReleaseMaterials.length) throw new Error('One or more official release materials could not be fingerprinted; refusing to publish a partial material refresh.')
const builds = owns('vbr') ? parseVbrBuilds(buildHtml) : []
const preliminaryVbrBuildsMerged = owns('vbr') ? mergeVbrBuilds(current, builds) : { catalog: structuredClone(current), additions: 0 }
const hasDocumentedVbrRouteToRecommended = current.upgradePaths.some((path) => path.productId === 'vbr' && path.sourceIds.includes('kb2053') && path.toReleaseId === preliminaryVbrBuildsMerged.catalog.products.find((product) => product.id === 'vbr')?.recommendedReleaseId)
const hasOutdatedExactVbrRoute = current.upgradePaths.some((path) => path.productId === 'vbr' && path.sourceIds.includes('kb2053') && !Array.isArray(path.fromVersionPrefixes) && path.toReleaseId !== preliminaryVbrBuildsMerged.catalog.products.find((product) => product.id === 'vbr')?.recommendedReleaseId)
const shouldCheckVbrUpgradeGuidance = owns('vbr') && (preliminaryVbrBuildsMerged.additions > 0 || !hasDocumentedVbrRouteToRecommended || hasOutdatedExactVbrRoute)
const vbrUpgradeHtml = shouldCheckVbrUpgradeGuidance ? await fetchSource(vbrUpgradeSource) : undefined
const vbrRoutes = vbrUpgradeHtml ? parseVbrUpgradePaths(vbrUpgradeHtml) : []
const oneBuilds = owns('veeam-one') ? parseProductBuilds(oneBuildHtml, 'Veeam ONE') : []
const vroBuilds = owns('vro') ? parseProductBuilds(vroBuildHtml, 'Veeam Recovery Orchestrator') : []
const vspcBuilds = owns('vspc') ? parseProductBuilds(vspcBuildHtml, 'Veeam Service Provider Console') : []
const vb365Builds = owns('vb365') ? parseVb365Builds(vb365BuildHtml) : []
const vb365Routes = owns('vb365') ? parseVb365UpgradePaths(vb365UpgradeHtml) : []
const fulfilledArticleHtml = (articleId) => articleResponseById.get(articleId)?.status === 'fulfilled' ? articleResponseById.get(articleId).value.html : undefined
const securityHtml = fulfilledArticleHtml('kb4649')
let vbrAdvisories = []
let veeamOneAdvisories = []
let vspcBulletinAdvisories = []
try {
  if (securityHtml) {
    vbrAdvisories = parseVbrSecurityBulletin(securityHtml)
    veeamOneAdvisories = parseVeeamOneSecurityBulletin(securityHtml)
    vspcBulletinAdvisories = parseVspcSecurityBulletin(securityHtml)
  }
} catch {
  // The product-agnostic coverage gate below reports a safe, structured failure.
}
const parsedReleaseArticles = classifiedArticlesToFetch.filter((article) => article.classification === 'parsed')
const discoveredSecurityReleaseAdvisories = parsedReleaseArticles.flatMap((classifiedArticle) => {
  const html = fulfilledArticleHtml(classifiedArticle.articleId)
  if (!html) return []
  const vulnerabilityHtml = securityArticlePages[classifiedArticle.articleId]?.html
  const article = sourceArticleById.get(classifiedArticle.articleId)
  const productId = classifiedArticle.productIds[0]
  const product = {
    productId,
    productName: securityProducts[productId],
    ...(productId === 'vspc' ? { legacyVersionPrefixes: ['4.', '5.', '6.', '7.', '8.'] } : {}),
  }
  try {
    return [productId === 'vbr'
      ? parseVbrReleaseSecurityArticle(html, article, { vulnerabilityHtml })
      : parseProductReleaseSecurityArticle(html, article, product, { vulnerabilityHtml })]
  } catch {
    return []
  }
})
const currentVspcCves = new Set(current.securityFindings.filter((finding) => finding.productId === 'vspc').flatMap((finding) => finding.cves))
const vspcArticleById = new Map(vspcKbInventory.articles.map((article) => [article.id, article]))
const previouslyAutomaticallyParsedVspcArticleIds = new Set((current.vspcKbCvePageStates ?? [])
  .filter((state) => state.parsedModelFingerprint)
  .map((state) => state.articleId))
const automaticallyParsedVspcArticles = preliminaryVspcKbCoverage.pageStates.flatMap((state) => {
  const article = vspcArticleById.get(state.articleId)
  const missingCves = state.observedCveIds.filter((cve) => !currentVspcCves.has(cve))
  const continuingAutomaticArticle = previouslyAutomaticallyParsedVspcArticleIds.has(state.articleId)
  const entirelyNewCveSet = missingCves.length > 0 && missingCves.length === state.observedCveIds.length
  if (!article || article.type === 'security' || (!continuingAutomaticArticle && !entirelyNewCveSet) || VSPC_REVIEWED_CVE_EXCLUSIONS[state.articleId]) return []
  try {
    const advisory = parseProductReleaseSecurityArticle(vspcKbPages[state.articleId].html, article, {
      productId: 'vspc',
      productName: 'Veeam Service Provider Console',
      legacyVersionPrefixes: ['4.', '5.', '6.', '7.', '8.'],
    })
    return state.observedCveIds.every((cve) => advisory.records.some((record) => record.cve === cve)) ? [advisory] : []
  } catch {
    return []
  }
})
const discoveredReleaseAdvisories = [...discoveredSecurityReleaseAdvisories, ...automaticallyParsedVspcArticles]
const discoveredVeeamOneLegacyArticles = selectVeeamOneLegacySecurityArticles(securityFeed)
const discoveredVspcLegacyArticles = selectVspcLegacySecurityArticles(securityFeed)
const discoveredVeeamOneInventoryArticle = sourceArticleById.get('kb4858')
const discoveredVspcInventoryArticle = sourceArticleById.get('kb4856')
const discoveredVeeamOneLegacyAdvisories = discoveredVeeamOneLegacyArticles.flatMap((article) => {
  const html = fulfilledArticleHtml(article.id.toLowerCase())
  if (!html) return []
  try { return [parseVeeamOneLegacySecurityArticle(html, article)] } catch { return [] }
})
const discoveredVspcLegacyAdvisories = discoveredVspcLegacyArticles.flatMap((article) => {
  const html = fulfilledArticleHtml(article.id.toLowerCase())
  if (!html) return []
  try { return [parseVspcLegacySecurityArticle(html, article)] } catch { return [] }
})
const dynamicallyReviewableVspcAdvisoryById = new Map()
for (const advisory of [...discoveredSecurityReleaseAdvisories, ...automaticallyParsedVspcArticles, ...discoveredVspcLegacyAdvisories]) {
  if (advisory.productId === 'vspc') dynamicallyReviewableVspcAdvisoryById.set(advisory.source.id.toLowerCase(), advisory)
}
let dynamicVspcReleaseSecurityReview
for (const [articleId, advisory] of dynamicallyReviewableVspcAdvisoryById) {
  const article = vspcArticleById.get(articleId)
  const html = vspcKbPages[articleId]?.html
  if (!article || typeof html !== 'string' || !extractVspcReleaseSecuritySections(html, article).length) continue
  dynamicVspcReleaseSecurityReview = createVspcReleaseSecurityReviewFromParsedCves(html, article, advisory, {
    ...(dynamicVspcReleaseSecurityReview ? { reviewedArticles: dynamicVspcReleaseSecurityReview } : {}),
  })
}
const vspcReleaseSecurityPages = vspcKbInventory.articles.flatMap((article) =>
  typeof vspcKbPages[article.id]?.html === 'string' ? [{ article, html: vspcKbPages[article.id].html }] : [],
)
const vspcReleaseSecurity = parseVspcReleaseSecurityPages(vspcReleaseSecurityPages, {
  ...(dynamicVspcReleaseSecurityReview ? { reviewedArticles: dynamicVspcReleaseSecurityReview } : {}),
})
const parsedVspcModelsByArticleId = new Map()
for (const advisory of [...discoveredSecurityReleaseAdvisories, ...automaticallyParsedVspcArticles, ...discoveredVspcLegacyAdvisories]) {
  if (advisory.productId !== 'vspc') continue
  const articleId = advisory.source.id.toLowerCase()
  parsedVspcModelsByArticleId.set(articleId, [...(parsedVspcModelsByArticleId.get(articleId) ?? []), advisory])
}
if (vspcBulletinAdvisories.length) {
  parsedVspcModelsByArticleId.set('kb4649', [{ productId: 'vspc', source: { id: 'kb4649' }, records: vspcBulletinAdvisories }])
}
const parsedVspcModelFingerprints = Object.fromEntries([...parsedVspcModelsByArticleId]
  .map(([articleId, models]) => [articleId, fingerprintVspcParsedModel(models)]))
const kevCves = parseCisaKev(JSON.parse(kevPayload))
const lifecyclePolicies = parseLifecyclePolicies(lifecycleHtml)
const releaseInformationBuilds = owns('vbr') ? parseVbrReleaseInformation(releaseInformationHtml) : []
const releaseInformation13Builds = owns('vbr') ? parseVbrReleaseInformation(releaseInformation13Html) : []
if (owns('vbr') && builds.length < 10) throw new Error(`VBR build-number parser returned only ${builds.length} records; refusing to replace the catalog.`)
for (const [productId, records, minimum] of [['veeam-one', oneBuilds, 10], ['vro', vroBuilds, 5], ['vspc', vspcBuilds, 10], ['vb365', vb365Builds, 30]]) {
  if (owns(productId) && records.length < minimum) throw Object.assign(new Error(productId + ' build parser returned only ' + records.length + ' records; expected at least ' + minimum), { code: 'BUILD_PARSER_INCOMPLETE' })
}
if (owns('vb365') && vb365Routes.length < 7) throw new Error(`VB365 upgrade-path parser returned only ${vb365Routes.length} routes; refusing to replace the catalog.`)
if (shouldCheckVbrUpgradeGuidance && vbrRoutes.length < 1) throw new Error('VBR KB2053 parser returned no documented routes; refusing to replace the catalog.')
if (lifecyclePolicies.length < 10) throw new Error(`Lifecycle parser returned only ${lifecyclePolicies.length} rows; refusing to replace lifecycle guidance.`)
if (owns('vbr') && !releaseInformationBuilds.includes('12.3.2.4465')) throw new Error('VBR release-information KB did not yield build 12.3.2.4465; refusing to update release-note links.')
if (owns('vbr') && !releaseInformation13Builds.includes('13.0.0.4967')) throw new Error('VBR 13 release-information KB did not yield build 13.0.0.4967; refusing to update release-note links.')

const buildsMerged = preliminaryVbrBuildsMerged
const vbrPathsMerged = shouldCheckVbrUpgradeGuidance ? mergeVbrUpgradePaths(buildsMerged.catalog, vbrRoutes) : { catalog: buildsMerged.catalog, paths: 0 }
if (shouldCheckVbrUpgradeGuidance && vbrPathsMerged.paths < 1) throw new Error('VBR KB2053 merge produced no source-backed routes to the recommended release; refusing to replace the catalog.')
const oneBuildsMerged = owns('veeam-one') ? mergeProductBuilds(vbrPathsMerged.catalog, { productId: 'veeam-one', sourceId: oneBuildSource.id, records: oneBuilds }) : { catalog: vbrPathsMerged.catalog, additions: 0, paths: 0, attachments: 0 }
const vroBuildsMerged = owns('vro') ? mergeProductBuilds(oneBuildsMerged.catalog, { productId: 'vro', sourceId: vroBuildSource.id, records: vroBuilds }) : { catalog: oneBuildsMerged.catalog, additions: 0, paths: 0, attachments: 0 }
const vspcBuildsMerged = owns('vspc') ? mergeProductBuilds(vroBuildsMerged.catalog, { productId: 'vspc', sourceId: vspcBuildSource.id, records: vspcBuilds }) : { catalog: vroBuildsMerged.catalog, additions: 0, paths: 0, attachments: 0 }
const vb365BuildsMerged = owns('vb365') ? mergeVb365Builds(vspcBuildsMerged.catalog, vb365Builds, vb365BuildSource.id) : { catalog: vspcBuildsMerged.catalog, additions: 0, paths: 0, attachments: 0 }
const vb365PathsMerged = owns('vb365') ? mergeVb365UpgradePaths(vb365BuildsMerged.catalog, vb365Routes) : { catalog: vb365BuildsMerged.catalog, additions: 0, paths: 0, attachments: 0 }
const releaseInformation12Merged = owns('vbr') ? mergeVbrReleaseInformation(vb365PathsMerged.catalog, releaseInformationBuilds, releaseInformationSource.id) : { catalog: vb365PathsMerged.catalog, additions: 0, paths: 0, attachments: 0 }
const releaseInformationMerged = owns('vbr') ? mergeVbrReleaseInformation(releaseInformation12Merged.catalog, releaseInformation13Builds, releaseInformation13Source.id, { applianceUpdateHowToSourceId: 'vsa-update', updateHowToSourceId: 'vbr-update' }) : { catalog: releaseInformation12Merged.catalog, additions: 0, paths: 0, attachments: 0 }
const enterpriseManagerBuildsMerged = owns('enterprise-manager') ? mergeEnterpriseManagerBuilds(releaseInformationMerged.catalog) : { catalog: releaseInformationMerged.catalog, additions: 0, paths: 0, attachments: 0 }
const vbrMerged = mergeVbrSecurityBulletin(enterpriseManagerBuildsMerged.catalog, vbrAdvisories)
const oneMerged = mergeVeeamOneSecurityBulletin(vbrMerged.catalog, veeamOneAdvisories)
const vspcBulletinMerged = mergeVspcSecurityBulletin(oneMerged.catalog, vspcBulletinAdvisories)
const releaseSecurityMerged = mergeProductReleaseSecurityArticles(vspcBulletinMerged.catalog, discoveredReleaseAdvisories)
const oneLegacyMerged = mergeVeeamOneLegacySecurityArticles(releaseSecurityMerged.catalog, discoveredVeeamOneLegacyAdvisories)
const vspcLegacyMerged = mergeVspcLegacySecurityArticles(oneLegacyMerged.catalog, discoveredVspcLegacyAdvisories)
const vspcReleaseSecurityMerged = mergeVspcReleaseSecurityArticles(vspcLegacyMerged.catalog, vspcReleaseSecurity.advisories, { checkedAt: refreshedAt })
const reviewedSecurityMerged = mergeReviewedSecurityAdvisories(vspcReleaseSecurityMerged.catalog, { checkedAt: refreshedAt })
const lifecycleMerged = mergeLifecyclePolicies(reviewedSecurityMerged.catalog, lifecyclePolicies, new Date(refreshedAt))
const merged = mergeCisaKev(lifecycleMerged.catalog, kevCves)
const releaseMaterialsMerged = mergeReleaseMaterials(merged.catalog, fetchedReleaseMaterials, refreshedAt)
const materialSourceByUrl = new Map(releaseMaterialsMerged.catalog.sources.map((source) => [source.url, source.id]))
const generatedHighlights = fetchedReleaseMaterials.flatMap((material) => material.kind === 'whats-new' && material.text
  ? extractSourceSupportedHighlights(material.text, { ...material, sourceId: materialSourceByUrl.get(material.url) })
  : [])
const highlightsMerged = mergeSourceSupportedHighlights(releaseMaterialsMerged.catalog, generatedHighlights, fetchedReleaseMaterials.map((material) => materialSourceByUrl.get(material.url)).filter(Boolean))
merged.catalog = highlightsMerged.catalog
merged.catalog.generatedAt = refreshedAt
merged.catalog.securityFeedArticleIds = securityFeedArticleIds
merged.catalog.securityFeedRoutes = securityFeedRoutes
merged.catalog.securityFeedPageStates = [...current.securityFeedPageStates.filter(state => !selectedArticleIds.has(state.articleId)), ...securityFeedPageStates].sort((a,b) => a.articleId.localeCompare(b.articleId))
const discoveredSources = [
  ...[...discoveredReleaseAdvisories, ...discoveredVeeamOneLegacyAdvisories, ...discoveredVspcLegacyAdvisories].map((advisory) => ({ ...advisory.source, checkedAt: refreshedAt })),
  {
    id: discoveredVeeamOneInventoryArticle.id.toLowerCase(),
    title: `Veeam ${discoveredVeeamOneInventoryArticle.id.toUpperCase()}: ${discoveredVeeamOneInventoryArticle.seoTitle}`,
    url: new URL(discoveredVeeamOneInventoryArticle.url, 'https://www.veeam.com').toString(),
    checkedAt: refreshedAt,
  },
  {
    id: discoveredVspcInventoryArticle.id.toLowerCase(),
    title: `Veeam ${discoveredVspcInventoryArticle.id.toUpperCase()}: ${discoveredVspcInventoryArticle.seoTitle}`,
    url: new URL(discoveredVspcInventoryArticle.url, 'https://www.veeam.com').toString(),
    checkedAt: refreshedAt,
  },
]
merged.catalog.sources = merged.catalog.sources.map((item) =>
  item.id === buildSource.id || item.id === oneBuildSource.id || item.id === vroBuildSource.id || item.id === vspcBuildSource.id || item.id === vb365BuildSource.id || item.id === vb365UpgradeSource.id || (shouldCheckVbrUpgradeGuidance && item.id === vbrUpgradeSource.id) || item.id === securitySource.id || item.id === securityFeedSource.id || item.id === kevSource.id || item.id === lifecycleSource.id || item.id === releaseInformationSource.id || item.id === releaseInformation13Source.id || ['vbr-release-materials', 'one-release-materials', 'vro-release-materials', 'vspc-release-materials', 'vb365-release-materials'].includes(item.id) ? { ...item, checkedAt: refreshedAt } : item,
)
for (const source of discoveredSources) {
  const index = merged.catalog.sources.findIndex((item) => item.id === source.id)
  if (index < 0) merged.catalog.sources.push(source)
  else merged.catalog.sources[index] = source
}
for (const state of preliminaryVspcKbCoverage.pageStates) {
  if (VSPC_REVIEWED_CVE_EXCLUSIONS[state.articleId]) continue
  const article = vspcArticleById.get(state.articleId)
  const source = {
    id: state.articleId,
    title: `Veeam ${state.articleId.toUpperCase()}: ${article.seoTitle ?? article.title}`,
    url: new URL(article.url, 'https://www.veeam.com').toString(),
    checkedAt: refreshedAt,
  }
  const index = merged.catalog.sources.findIndex((item) => item.id === source.id)
  if (index < 0) merged.catalog.sources.push(source)
  else merged.catalog.sources[index] = source
  const cves = new Set(state.observedCveIds)
  for (const finding of merged.catalog.securityFindings) {
    if (finding.productId === 'vspc' && finding.cves.some((cve) => cves.has(cve)) && !finding.sourceIds.includes(state.articleId)) {
      finding.sourceIds.push(state.articleId)
    }
  }
}

if (owns('vspc')) {
let vspcCveRecordCoverage
try {
  console.log(`[catalog-refresh] Reconciling ${observedVspcCveIds.length} official VSPC CVE records.`)
  const vspcCveRecords = await fetchVspcCveRecords({
    cveIds: observedVspcCveIds,
    fetchRecord: ({ cveId, url }) => fetchSource({ id: `cve-record-${cveId.toLowerCase()}`, url }),
  })
  vspcCveRecordCoverage = assertVspcCveRecordCoverage({
    observedCveIds: observedVspcCveIds,
    records: vspcCveRecords,
    previousStates: current.vspcCveRecordStates,
    previousCatalog: current,
    catalog: merged.catalog,
    checkedAt: refreshedAt,
  })
} catch (error) {
  if (error instanceof VspcCveRecordCoverageError) {
    const annotation = JSON.stringify(error.report).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
    console.error(`::error title=VSPC CVE-record coverage gate failed::${annotation}`)
  }
  throw error
}
merged.catalog = vspcCveRecordCoverage.catalog
merged.catalog.vspcCveRecordStates = vspcCveRecordCoverage.states

let vspcKbCveCoverage
try {
  vspcKbCveCoverage = assertVspcKbCveCoverage({
    previousArticleIds: current.vspcKbArticleIds,
    previousPageStates: current.vspcKbCvePageStates,
    previousCatalog: current,
    parsedModelFingerprints: parsedVspcModelFingerprints,
    articles: vspcKbInventory.articles,
    pages: vspcKbPages,
    catalog: merged.catalog,
  })
} catch (error) {
  if (error instanceof VspcKbCveCoverageError) {
    const annotation = JSON.stringify(error.report).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
    console.error(`::error title=VSPC full-KB CVE coverage gate failed::${annotation}`)
  }
  throw error
}
merged.catalog.vspcKbArticleIds = vspcKbCveCoverage.articleIds
merged.catalog.vspcKbCvePageStates = vspcKbCveCoverage.pageStates
}

const parsedSecurityCoverage = [
  ...discoveredSecurityReleaseAdvisories,
  ...discoveredVeeamOneLegacyAdvisories,
  ...discoveredVspcLegacyAdvisories,
  ...REVIEWED_SECURITY_PARSED_COVERAGE,
  { articleId: 'kb4649', productId: 'vbr', cveIds: vbrAdvisories.map((record) => record.cve) },
  { articleId: 'kb4649', productId: 'veeam-one', cveIds: veeamOneAdvisories.map((record) => record.cve) },
  { articleId: 'kb4649', productId: 'vspc', cveIds: vspcBulletinAdvisories.map((record) => record.cve) },
]
try {
  assertSecurityFeedCoverage({
    articles: securityArticles.filter(article => selectedArticleIds.has(article.id.toLowerCase())),
    classifications: securityClassifications,
    articlePages: securityArticlePages,
    parsedCoverage: parsedSecurityCoverage,
    catalog: merged.catalog,
  })
} catch (error) {
  if (error instanceof SecurityFeedCoverageError) {
    const annotation = JSON.stringify(error.report).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
    console.error(`::error title=Security KB coverage gate failed::${annotation}`)
  }
  throw error
}


// Ownership is accepted only by the assembler after this transaction passes.
// Do not carry a previous registry into the atomic comparison of new evidence.
delete merged.catalog.sourceOwnership
return { catalog: merged.catalog, baselines: { schemaVersion: 1, articles: { ...baselines.articles, ...baselineReview.next.articles } }, texts: reviewTexts, equivalentChanges: baselineReview.equivalentChanges, inventoryChanges: baselineReview.inventoryChanges }
}
