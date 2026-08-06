import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
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
import { contentFingerprint, extractSourceSupportedHighlights, mergeReleaseMaterials, mergeSourceSupportedHighlights, parseReleaseMaterials, textFromDocument } from './lib/release-materials.mjs'
import { createCatalogSourceFetcher } from './lib/source-fetch.mjs'
import { SecurityFeedCoverageError, assertSecurityFeedContinuity, assertSecurityFeedCoverage, assertSecurityFeedPageStateContinuity, assertSecurityFeedRouteContinuity, buildSecurityArticleClassifications, classifySecurityFeedArticles, extractCveIds, extractSecurityArticleScope, fetchSecurityFeedPages, fingerprintSecurityArticleContent, splitSecurityArticleVulnerabilityContent } from './lib/security-feed-coverage.mjs'
import { REVIEWED_SECURITY_CLASSIFICATIONS, REVIEWED_SECURITY_PARSED_COVERAGE, REVIEWED_SECURITY_OBSERVATION_POLICY, mergeReviewedSecurityAdvisories, normalizeReviewedSecurityMainArticle, observeReviewedSecurityArticle } from './lib/reviewed-security-advisories.mjs'

const snapshot = new URL('../src/data/catalog.snapshot.json', import.meta.url)
const args = process.argv.slice(2)
const candidatePath = args.find((arg) => !arg.startsWith('--'))
const live = args.includes('--live')

function runValidation(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/validate-catalog.mjs', path], { stdio: 'inherit' })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Catalog validation exited ${code}`)))
  })
}

async function validateThenInstall(candidate) {
  const workspace = await mkdtemp(join(tmpdir(), 'upgrade-brief-'))
  const candidateFile = join(workspace, 'catalog.snapshot.json')
  try {
    await writeFile(candidateFile, `${JSON.stringify(candidate, null, 2)}\n`)
    await runValidation(candidateFile)
    await writeFile(snapshot, await readFile(candidateFile))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

if (candidatePath) {
  await validateThenInstall(JSON.parse(await readFile(candidatePath, 'utf8')))
  console.log('Candidate catalog validated and installed.')
  process.exit(0)
}

if (!live) {
  await runValidation(fileURLToPath(snapshot))
  console.log('No refresh requested. The committed snapshot remains unchanged.')
  process.exit(0)
}

const current = JSON.parse(await readFile(snapshot, 'utf8'))
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
const sourceFetcher = createCatalogSourceFetcher()

const securityProducts = {
  vbr: 'Veeam Backup & Replication',
  'enterprise-manager': 'Veeam Backup Enterprise Manager',
  'veeam-one': 'Veeam ONE',
  vro: 'Veeam Recovery Orchestrator',
  vspc: 'Veeam Service Provider Console',
  vb365: 'Veeam Backup for Microsoft 365',
}
const pinnedSecurityArticles = [
  { id: 'kb3103', type: 'security', url: '/kb3103', seoTitle: 'List of Security Fixes and Improvements in Veeam Backup & Replication', product: [{ title: 'Veeam Backup & Replication' }] },
  { id: 'kb4858', type: 'security', url: '/kb4858', seoTitle: 'List of Security Fixes and Improvements in Veeam ONE', product: [{ title: 'Veeam ONE' }] },
  { id: 'kb4857', type: 'security', url: '/kb4857', seoTitle: 'List of Security Fixes and Improvements in Veeam Recovery Orchestrator', product: [{ title: 'Veeam Recovery Orchestrator' }] },
  { id: 'kb4856', type: 'security', url: '/kb4856', seoTitle: 'List of Security Fixes and Improvements in Veeam Service Provider Console', product: [{ title: 'Veeam Service Provider Console' }] },
]
const securityClassificationOverrides = {
  ...REVIEWED_SECURITY_CLASSIFICATIONS,
  kb3144: { classification: 'dedicated', productIds: ['veeam-one'] },
  kb3221: { classification: 'dedicated', productIds: ['veeam-one'] },
  kb4575: { classification: 'dedicated', productIds: ['vspc'] },
  kb4679: { classification: 'dedicated', productIds: ['vspc'] },
  kb4858: { classification: 'inventory', productIds: ['veeam-one'] },
  kb4856: { classification: 'inventory', productIds: ['vspc'] },
  kb4582: { classification: 'out-of-scope' },
  kb4374: { classification: 'out-of-scope' },
  kb4338: { classification: 'out-of-scope' },
  kb4289: { classification: 'out-of-scope' },
  kb4261: { classification: 'out-of-scope' },
  kb4236: { classification: 'out-of-scope' },
  kb3108: { classification: 'out-of-scope' },
  kb3109: { classification: 'out-of-scope' },
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
const releaseMaterialEndpoint = 'https://helpcenter.veeam.com/services/component/technical_documentation_table/select'

const [buildHtml, oneBuildHtml, vroBuildHtml, vspcBuildHtml, vb365BuildHtml, vb365UpgradeHtml, kevPayload, lifecycleHtml, releaseInformationHtml, releaseInformation13Html] = await Promise.all([fetchSource(buildSource), fetchSource(oneBuildSource), fetchSource(vroBuildSource), fetchSource(vspcBuildSource), fetchSource(vb365BuildSource), fetchSource(vb365UpgradeSource), fetchSource(kevSource), fetchSource(lifecycleSource), fetchSource(releaseInformationSource), fetchSource(releaseInformation13Source)])
const securityFeed = await fetchSecurityFeedPages({
  minimumArticleCount: 46,
  fetchPage: ({ offset, limit }) => fetchSource({
    id: `security-kb-${offset}`,
    url: `https://www.veeam.com/services/kb-articles?${new URLSearchParams({ type: 'security', offset: String(offset), limit: String(limit) })}`,
  }),
})
const securityFeedArticleIds = assertSecurityFeedContinuity(current.securityFeedArticleIds, securityFeed.articles)
const securityArticles = [...securityFeed.articles, ...pinnedSecurityArticles.filter((pinned) => !securityFeed.articles.some((article) => article.id.toLowerCase() === pinned.id))]
const securityClassifications = buildSecurityArticleClassifications(securityArticles, securityClassificationOverrides)
const classifiedSecurityArticles = classifySecurityFeedArticles({ articles: securityArticles, classifications: securityClassifications })
const securityFeedArticleIdSet = new Set(securityFeed.articles.map((article) => article.id.toLowerCase()))
const securityFeedRoutes = assertSecurityFeedRouteContinuity(current.securityFeedRoutes, classifiedSecurityArticles
  .filter((article) => securityFeedArticleIdSet.has(article.articleId))
  .map(({ articleId, classification, productIds, multiProduct }) => ({ articleId, classification, productIds, multiProduct })))
const sourceArticleById = new Map(securityArticles.map((article) => [article.id.toLowerCase(), article]))
const classifiedArticlesToFetch = classifiedSecurityArticles.filter((article) => article.classification !== 'unclassified')
const classifiedArticleResponses = await Promise.allSettled(classifiedArticlesToFetch.map(async (article) => ({
    article,
    html: await fetchSource({ id: article.articleId, url: new URL(sourceArticleById.get(article.articleId).url, 'https://www.veeam.com').toString() }),
  })))
const articleResponseById = new Map(classifiedArticleResponses.map((response, index) => [classifiedArticlesToFetch[index].articleId, response]))
const securityFeedPageStates = assertSecurityFeedPageStateContinuity(current.securityFeedPageStates, classifiedArticlesToFetch.flatMap((article) => {
  const response = articleResponseById.get(article.articleId)
  if (response.status !== 'fulfilled') return []
  const scope = extractSecurityArticleScope(response.value.html)
  const normalizedContent = normalizeReviewedSecurityMainArticle(response.value.html)
  const fingerprinted = ['dedicated', 'inventory', 'informational', 'out-of-scope'].includes(article.classification)
  return [{
    articleId: article.articleId,
    productIds: scope.productIds,
    hasOutOfScopeProduct: scope.hasOutOfScopeProduct,
    ...(fingerprinted ? { contentFingerprint: fingerprintSecurityArticleContent(normalizedContent) } : {}),
    ...(article.classification === 'inventory' ? { observedCveIds: extractCveIds(normalizedContent) } : {}),
  }]
}))
const securityArticlePages = Object.fromEntries(classifiedArticlesToFetch.map((article) => {
  const response = articleResponseById.get(article.articleId)
  if (response.status !== 'fulfilled') return [article.articleId, response]
  const html = response.value.html
  if (!REVIEWED_SECURITY_OBSERVATION_POLICY[article.articleId]) {
    const section = splitSecurityArticleVulnerabilityContent(html)
    const scope = extractSecurityArticleScope(section.vulnerabilityContent)
    return [article.articleId, {
      html: section.vulnerabilityContent,
      trailingCveIds: extractCveIds(section.trailingContent),
      observedProductIds: scope.productIds,
      observedOutOfScopeProduct: scope.hasOutOfScopeProduct,
    }]
  }
  const observation = observeReviewedSecurityArticle(article.articleId, html)
  return [article.articleId, article.classification === 'informational'
    ? { content: normalizeReviewedSecurityMainArticle(html), observedCves: observation.observedCves }
    : { html, ...observation }]
}))
const releaseMaterialPayloads = await Promise.all(releaseMaterialProducts.map(async (product) => ({
  ...product,
  payload: JSON.parse(await fetchSource({
    id: `release-materials-${product.productId}`,
    url: `${releaseMaterialEndpoint}?${new URLSearchParams({ productId: product.helpCenterProductId, localeCode: 'en', isInitial: 'true' })}`,
  })),
})))
const normalizedTitle = (value) => String(value ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
if (!releaseMaterialPayloads.every(({ productTitle, payload }) => normalizedTitle(payload?.payload?.products?.[0]?.productTitle) === productTitle)) throw new Error('Help Center release-material discovery returned a mismatched product response.')
const discoveredReleaseMaterials = releaseMaterialPayloads.flatMap(({ productId, payload }) => parseReleaseMaterials(payload, productId))
if (!releaseMaterialProducts.every((product) => discoveredReleaseMaterials.some((material) => material.productId === product.productId))) throw new Error('Help Center release-material discovery returned no current document for one or more tracked products.')
const releaseMaterialDocuments = await Promise.allSettled(discoveredReleaseMaterials.map(async (material) => {
  const document = await fetchDocument(material.url, `release-material-${material.productId}-${material.releaseFamily}-${material.kind}`)
  const contentHash = contentFingerprint(document.bytes)
  let text
  try { text = await textFromDocument(document.bytes, document.contentType, material.url) } catch { text = undefined }
  return { ...material, contentHash, text }
}))
const fetchedReleaseMaterials = releaseMaterialDocuments.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
if (fetchedReleaseMaterials.length !== discoveredReleaseMaterials.length) throw new Error('One or more official release materials could not be fingerprinted; refusing to publish a partial material refresh.')
const builds = parseVbrBuilds(buildHtml)
const preliminaryVbrBuildsMerged = mergeVbrBuilds(current, builds)
const hasDocumentedVbrRouteToRecommended = current.upgradePaths.some((path) => path.productId === 'vbr' && path.sourceIds.includes('kb2053') && path.toReleaseId === preliminaryVbrBuildsMerged.catalog.products.find((product) => product.id === 'vbr')?.recommendedReleaseId)
const hasOutdatedExactVbrRoute = current.upgradePaths.some((path) => path.productId === 'vbr' && path.sourceIds.includes('kb2053') && !Array.isArray(path.fromVersionPrefixes) && path.toReleaseId !== preliminaryVbrBuildsMerged.catalog.products.find((product) => product.id === 'vbr')?.recommendedReleaseId)
const shouldCheckVbrUpgradeGuidance = preliminaryVbrBuildsMerged.additions > 0 || !hasDocumentedVbrRouteToRecommended || hasOutdatedExactVbrRoute
const vbrUpgradeHtml = shouldCheckVbrUpgradeGuidance ? await fetchSource(vbrUpgradeSource) : undefined
const vbrRoutes = vbrUpgradeHtml ? parseVbrUpgradePaths(vbrUpgradeHtml) : []
const oneBuilds = parseProductBuilds(oneBuildHtml, 'Veeam ONE')
const vroBuilds = parseProductBuilds(vroBuildHtml, 'Veeam Recovery Orchestrator')
const vspcBuilds = parseProductBuilds(vspcBuildHtml, 'Veeam Service Provider Console')
const vb365Builds = parseVb365Builds(vb365BuildHtml)
const vb365Routes = parseVb365UpgradePaths(vb365UpgradeHtml)
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
const parsedReleaseArticles = classifiedSecurityArticles.filter((article) => article.classification === 'parsed')
const discoveredReleaseAdvisories = parsedReleaseArticles.flatMap((classifiedArticle) => {
  const html = fulfilledArticleHtml(classifiedArticle.articleId)
  if (!html) return []
  const vulnerabilityHtml = securityArticlePages[classifiedArticle.articleId]?.html
  const article = sourceArticleById.get(classifiedArticle.articleId)
  const productId = classifiedArticle.productIds[0]
  const product = { productId, productName: securityProducts[productId] }
  try {
    return [productId === 'vbr'
      ? parseVbrReleaseSecurityArticle(html, article, { vulnerabilityHtml })
      : parseProductReleaseSecurityArticle(html, article, product, { vulnerabilityHtml })]
  } catch {
    return []
  }
})
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
const kevCves = parseCisaKev(JSON.parse(kevPayload))
const lifecyclePolicies = parseLifecyclePolicies(lifecycleHtml)
const releaseInformationBuilds = parseVbrReleaseInformation(releaseInformationHtml)
const releaseInformation13Builds = parseVbrReleaseInformation(releaseInformation13Html)
if (builds.length < 10) throw new Error(`VBR build-number parser returned only ${builds.length} records; refusing to replace the catalog.`)
if (oneBuilds.length < 10 || vroBuilds.length < 5 || vspcBuilds.length < 10 || vb365Builds.length < 30) throw new Error(`Product build parser returned incomplete data: ${oneBuilds.length} Veeam ONE, ${vroBuilds.length} VRO, ${vspcBuilds.length} VSPC, ${vb365Builds.length} VB365.`)
if (vb365Routes.length < 7) throw new Error(`VB365 upgrade-path parser returned only ${vb365Routes.length} routes; refusing to replace the catalog.`)
if (shouldCheckVbrUpgradeGuidance && vbrRoutes.length < 1) throw new Error('VBR KB2053 parser returned no documented routes; refusing to replace the catalog.')
if (lifecyclePolicies.length < 10) throw new Error(`Lifecycle parser returned only ${lifecyclePolicies.length} rows; refusing to replace lifecycle guidance.`)
if (!releaseInformationBuilds.includes('12.3.2.4465')) throw new Error('VBR release-information KB did not yield build 12.3.2.4465; refusing to update release-note links.')
if (!releaseInformation13Builds.includes('13.0.0.4967')) throw new Error('VBR 13 release-information KB did not yield build 13.0.0.4967; refusing to update release-note links.')

const buildsMerged = preliminaryVbrBuildsMerged
const vbrPathsMerged = shouldCheckVbrUpgradeGuidance ? mergeVbrUpgradePaths(buildsMerged.catalog, vbrRoutes) : { catalog: buildsMerged.catalog, paths: 0 }
const oneBuildsMerged = mergeProductBuilds(vbrPathsMerged.catalog, { productId: 'veeam-one', sourceId: oneBuildSource.id, records: oneBuilds })
const vroBuildsMerged = mergeProductBuilds(oneBuildsMerged.catalog, { productId: 'vro', sourceId: vroBuildSource.id, records: vroBuilds })
const vspcBuildsMerged = mergeProductBuilds(vroBuildsMerged.catalog, { productId: 'vspc', sourceId: vspcBuildSource.id, records: vspcBuilds })
const vb365BuildsMerged = mergeVb365Builds(vspcBuildsMerged.catalog, vb365Builds, vb365BuildSource.id)
const vb365PathsMerged = mergeVb365UpgradePaths(vb365BuildsMerged.catalog, vb365Routes)
const releaseInformation12Merged = mergeVbrReleaseInformation(vb365PathsMerged.catalog, releaseInformationBuilds, releaseInformationSource.id)
const releaseInformationMerged = mergeVbrReleaseInformation(releaseInformation12Merged.catalog, releaseInformation13Builds, releaseInformation13Source.id)
const enterpriseManagerBuildsMerged = mergeEnterpriseManagerBuilds(releaseInformationMerged.catalog)
const vbrMerged = mergeVbrSecurityBulletin(enterpriseManagerBuildsMerged.catalog, vbrAdvisories)
const oneMerged = mergeVeeamOneSecurityBulletin(vbrMerged.catalog, veeamOneAdvisories)
const vspcBulletinMerged = mergeVspcSecurityBulletin(oneMerged.catalog, vspcBulletinAdvisories)
const releaseSecurityMerged = mergeProductReleaseSecurityArticles(vspcBulletinMerged.catalog, discoveredReleaseAdvisories)
const oneLegacyMerged = mergeVeeamOneLegacySecurityArticles(releaseSecurityMerged.catalog, discoveredVeeamOneLegacyAdvisories)
const vspcLegacyMerged = mergeVspcLegacySecurityArticles(oneLegacyMerged.catalog, discoveredVspcLegacyAdvisories)
const refreshedAt = new Date().toISOString()
const reviewedSecurityMerged = mergeReviewedSecurityAdvisories(vspcLegacyMerged.catalog, { checkedAt: refreshedAt })
const lifecycleMerged = mergeLifecyclePolicies(reviewedSecurityMerged.catalog, lifecyclePolicies)
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
merged.catalog.securityFeedPageStates = securityFeedPageStates
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

const parsedSecurityCoverage = [
  ...discoveredReleaseAdvisories,
  ...discoveredVeeamOneLegacyAdvisories,
  ...discoveredVspcLegacyAdvisories,
  ...REVIEWED_SECURITY_PARSED_COVERAGE,
  { articleId: 'kb4649', productId: 'vbr', cveIds: vbrAdvisories.map((record) => record.cve) },
  { articleId: 'kb4649', productId: 'veeam-one', cveIds: veeamOneAdvisories.map((record) => record.cve) },
  { articleId: 'kb4649', productId: 'vspc', cveIds: vspcBulletinAdvisories.map((record) => record.cve) },
]
let securityCoverage
try {
  securityCoverage = assertSecurityFeedCoverage({
    articles: securityArticles,
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

await validateThenInstall(merged.catalog)
const veeamOneReleaseFindings = discoveredReleaseAdvisories.filter((advisory) => advisory.productId === 'veeam-one').reduce((total, advisory) => total + advisory.records.length, 0)
const vspcReleaseFindings = discoveredReleaseAdvisories.filter((advisory) => advisory.productId === 'vspc').reduce((total, advisory) => total + advisory.records.length, 0)
console.log(`Catalog refresh complete: ${builds.length} VBR, ${oneBuilds.length} Veeam ONE, ${vroBuilds.length} VRO, ${vspcBuilds.length} VSPC, and ${vb365Builds.length} VB365 builds; ${buildsMerged.additions + oneBuildsMerged.additions + vroBuildsMerged.additions + vspcBuildsMerged.additions + vb365BuildsMerged.additions + enterpriseManagerBuildsMerged.additions} releases added; ${shouldCheckVbrUpgradeGuidance ? `${vbrPathsMerged.paths} VBR KB2053 routes checked; ` : ''}${vb365PathsMerged.paths} VB365 documented routes; ${enterpriseManagerBuildsMerged.additions} Enterprise Manager build entries; ${releaseInformation12Merged.attachments + releaseInformationMerged.attachments} VBR release-information links; ${releaseMaterialsMerged.additions} release materials added, ${releaseMaterialsMerged.changes} changed, and ${highlightsMerged.additions} source-supported highlights added; ${lifecycleMerged.notices} lifecycle notices; ${vbrMerged.findings} VBR bulletin advisories; ${releaseSecurityMerged.findings} release advisories from ${discoveredReleaseAdvisories.length} parseable security KBs; ${reviewedSecurityMerged.findings} reviewed cross-product findings; ${securityCoverage.report.articleCount} security KBs classified with fingerprint ${securityCoverage.report.fingerprint}; ${oneMerged.findings + oneLegacyMerged.findings + veeamOneReleaseFindings} Veeam ONE CVE findings; ${vspcBulletinMerged.findings + vspcLegacyMerged.findings + vspcReleaseFindings} VSPC CVE findings; ${merged.matches} KEV matches.`)
