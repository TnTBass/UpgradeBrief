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
import { mergeVbrSecurityBulletin, mergeVeeamOneSecurityBulletin, parseVbrSecurityBulletin, parseVeeamOneSecurityBulletin } from './lib/vbr-security.mjs'
import { mergeProductReleaseSecurityArticles, parseProductReleaseSecurityArticle, parseVbrReleaseSecurityArticle, selectProductReleaseSecurityArticles, selectVbrSecurityArticles } from './lib/vbr-release-security.mjs'
import { mergeCisaKev, parseCisaKev } from './lib/cisa-kev.mjs'
import { mergeLifecyclePolicies, parseLifecyclePolicies } from './lib/lifecycle.mjs'
import { mergeVbrReleaseInformation, parseVbrReleaseInformation } from './lib/vbr-release-information.mjs'
import { contentFingerprint, extractSourceSupportedHighlights, mergeReleaseMaterials, mergeSourceSupportedHighlights, parseReleaseMaterials, textFromDocument } from './lib/release-materials.mjs'

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
const securitySource = current.sources.find((item) => item.id === 'kb4649')
const securityFeedSource = current.sources.find((item) => item.id === 'security-kb')
const kevSource = current.sources.find((item) => item.id === 'cisa-kev')
const lifecycleSource = current.sources.find((item) => item.id === 'lifecycle')
const releaseInformationSource = current.sources.find((item) => item.id === 'kb4696')
const releaseInformation13Source = current.sources.find((item) => item.id === 'kb4738')
if (!buildSource || !oneBuildSource || !vroBuildSource || !vspcBuildSource || !vb365BuildSource || !vb365UpgradeSource || !securitySource || !securityFeedSource || !kevSource || !lifecycleSource || !releaseInformationSource || !releaseInformation13Source) throw new Error('A required catalog source is missing from the catalog.')

async function fetchSource(source) {
  const response = await fetch(source.url, {
    headers: { 'user-agent': 'UpgradeBrief catalog refresher (+https://github.com/TnTBass/UpgradeBrief)' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${source.id} request failed with HTTP ${response.status}`)
  return response.text()
}

async function fetchDocument(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'UpgradeBrief catalog refresher (+https://github.com/TnTBass/UpgradeBrief)' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${url} request failed with HTTP ${response.status}`)
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

const [buildHtml, oneBuildHtml, vroBuildHtml, vspcBuildHtml, vb365BuildHtml, vb365UpgradeHtml, securityHtml, securityFeedPayload, kevPayload, lifecycleHtml, releaseInformationHtml, releaseInformation13Html] = await Promise.all([fetchSource(buildSource), fetchSource(oneBuildSource), fetchSource(vroBuildSource), fetchSource(vspcBuildSource), fetchSource(vb365BuildSource), fetchSource(vb365UpgradeSource), fetchSource(securitySource), fetchSource({ ...securityFeedSource, url: 'https://www.veeam.com/services/kb-articles?type=security&offset=0&limit=100' }), fetchSource(kevSource), fetchSource(lifecycleSource), fetchSource(releaseInformationSource), fetchSource(releaseInformation13Source)])
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
  const document = await fetchDocument(material.url)
  const contentHash = contentFingerprint(document.bytes)
  let text
  try { text = await textFromDocument(document.bytes, document.contentType, material.url) } catch { text = undefined }
  return { ...material, contentHash, text }
}))
const fetchedReleaseMaterials = releaseMaterialDocuments.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
if (fetchedReleaseMaterials.length !== discoveredReleaseMaterials.length) throw new Error('One or more official release materials could not be fingerprinted; refusing to publish a partial material refresh.')
const builds = parseVbrBuilds(buildHtml)
const oneBuilds = parseProductBuilds(oneBuildHtml, 'Veeam ONE')
const vroBuilds = parseProductBuilds(vroBuildHtml, 'Veeam Recovery Orchestrator')
const vspcBuilds = parseProductBuilds(vspcBuildHtml, 'Veeam Service Provider Console')
const vb365Builds = parseVb365Builds(vb365BuildHtml)
const vb365Routes = parseVb365UpgradePaths(vb365UpgradeHtml)
const vbrAdvisories = parseVbrSecurityBulletin(securityHtml)
const veeamOneAdvisories = parseVeeamOneSecurityBulletin(securityHtml)
const discoveredVbrArticles = selectVbrSecurityArticles(JSON.parse(securityFeedPayload))
const discoveredVspcArticles = selectProductReleaseSecurityArticles(JSON.parse(securityFeedPayload), 'Veeam Service Provider Console')
const discoveredVb365Articles = selectProductReleaseSecurityArticles(JSON.parse(securityFeedPayload), ['Veeam Backup for Microsoft 365', 'Veeam Backup for Microsoft Office 365'])
const discoveredResponses = await Promise.allSettled([...discoveredVbrArticles.map((article) => ({ article, product: { productId: 'vbr', productName: 'Veeam Backup & Replication' } })), ...discoveredVspcArticles.map((article) => ({ article, product: { productId: 'vspc', productName: 'Veeam Service Provider Console' } })), ...discoveredVb365Articles.map((article) => ({ article, product: { productId: 'vb365', productName: 'Veeam Backup for Microsoft 365' } }))].map(async ({ article, product }) => ({
  article,
  product,
  html: await fetchSource({ id: article.id, url: new URL(article.url, 'https://www.veeam.com').toString() }),
})))
const discoveredReleaseAdvisories = discoveredResponses.flatMap((response) => {
  if (response.status !== 'fulfilled') return []
  try {
    return [response.value.product.productId === 'vbr'
      ? parseVbrReleaseSecurityArticle(response.value.html, response.value.article)
      : parseProductReleaseSecurityArticle(response.value.html, response.value.article, response.value.product)]
  } catch {
    return []
  }
})
const kevCves = parseCisaKev(JSON.parse(kevPayload))
const lifecyclePolicies = parseLifecyclePolicies(lifecycleHtml)
const releaseInformationBuilds = parseVbrReleaseInformation(releaseInformationHtml)
const releaseInformation13Builds = parseVbrReleaseInformation(releaseInformation13Html)
if (builds.length < 10) throw new Error(`VBR build-number parser returned only ${builds.length} records; refusing to replace the catalog.`)
if (oneBuilds.length < 10 || vroBuilds.length < 5 || vspcBuilds.length < 10 || vb365Builds.length < 30) throw new Error(`Product build parser returned incomplete data: ${oneBuilds.length} Veeam ONE, ${vroBuilds.length} VRO, ${vspcBuilds.length} VSPC, ${vb365Builds.length} VB365.`)
if (vb365Routes.length < 7) throw new Error(`VB365 upgrade-path parser returned only ${vb365Routes.length} routes; refusing to replace the catalog.`)
if (vbrAdvisories.length < 6 || veeamOneAdvisories.length < 6) throw new Error(`Security parser returned ${vbrAdvisories.length} VBR and ${veeamOneAdvisories.length} Veeam ONE advisories; refusing to replace the catalog.`)
if (!discoveredReleaseAdvisories.some((advisory) => advisory.source.id === 'kb4831')) throw new Error('Security feed did not yield the supported KB4831 VBR advisory; refusing to replace the catalog.')
if (lifecyclePolicies.length < 10) throw new Error(`Lifecycle parser returned only ${lifecyclePolicies.length} rows; refusing to replace lifecycle guidance.`)
if (!releaseInformationBuilds.includes('12.3.2.4465')) throw new Error('VBR release-information KB did not yield build 12.3.2.4465; refusing to update release-note links.')
if (!releaseInformation13Builds.includes('13.0.0.4967')) throw new Error('VBR 13 release-information KB did not yield build 13.0.0.4967; refusing to update release-note links.')

const buildsMerged = mergeVbrBuilds(current, builds)
const oneBuildsMerged = mergeProductBuilds(buildsMerged.catalog, { productId: 'veeam-one', sourceId: oneBuildSource.id, records: oneBuilds })
const vroBuildsMerged = mergeProductBuilds(oneBuildsMerged.catalog, { productId: 'vro', sourceId: vroBuildSource.id, records: vroBuilds })
const vspcBuildsMerged = mergeProductBuilds(vroBuildsMerged.catalog, { productId: 'vspc', sourceId: vspcBuildSource.id, records: vspcBuilds })
const vb365BuildsMerged = mergeVb365Builds(vspcBuildsMerged.catalog, vb365Builds, vb365BuildSource.id)
const vb365PathsMerged = mergeVb365UpgradePaths(vb365BuildsMerged.catalog, vb365Routes)
const releaseInformation12Merged = mergeVbrReleaseInformation(vb365PathsMerged.catalog, releaseInformationBuilds, releaseInformationSource.id)
const releaseInformationMerged = mergeVbrReleaseInformation(releaseInformation12Merged.catalog, releaseInformation13Builds, releaseInformation13Source.id)
const enterpriseManagerBuildsMerged = mergeEnterpriseManagerBuilds(releaseInformationMerged.catalog)
const vbrMerged = mergeVbrSecurityBulletin(enterpriseManagerBuildsMerged.catalog, vbrAdvisories)
const oneMerged = mergeVeeamOneSecurityBulletin(vbrMerged.catalog, veeamOneAdvisories)
const releaseSecurityMerged = mergeProductReleaseSecurityArticles(oneMerged.catalog, discoveredReleaseAdvisories)
const lifecycleMerged = mergeLifecyclePolicies(releaseSecurityMerged.catalog, lifecyclePolicies)
const merged = mergeCisaKev(lifecycleMerged.catalog, kevCves)
const refreshedAt = new Date().toISOString()
const releaseMaterialsMerged = mergeReleaseMaterials(merged.catalog, fetchedReleaseMaterials, refreshedAt)
const materialSourceByUrl = new Map(releaseMaterialsMerged.catalog.sources.map((source) => [source.url, source.id]))
const generatedHighlights = fetchedReleaseMaterials.flatMap((material) => material.kind === 'whats-new' && material.text
  ? extractSourceSupportedHighlights(material.text, { ...material, sourceId: materialSourceByUrl.get(material.url) })
  : [])
const highlightsMerged = mergeSourceSupportedHighlights(releaseMaterialsMerged.catalog, generatedHighlights, fetchedReleaseMaterials.map((material) => materialSourceByUrl.get(material.url)).filter(Boolean))
merged.catalog = highlightsMerged.catalog
merged.catalog.generatedAt = refreshedAt
const discoveredSources = discoveredReleaseAdvisories.map((advisory) => ({ ...advisory.source, checkedAt: refreshedAt }))
merged.catalog.sources = merged.catalog.sources.map((item) =>
  item.id === buildSource.id || item.id === oneBuildSource.id || item.id === vroBuildSource.id || item.id === vspcBuildSource.id || item.id === vb365BuildSource.id || item.id === vb365UpgradeSource.id || item.id === securitySource.id || item.id === securityFeedSource.id || item.id === kevSource.id || item.id === lifecycleSource.id || item.id === releaseInformationSource.id || item.id === releaseInformation13Source.id || ['vbr-release-materials', 'one-release-materials', 'vro-release-materials', 'vspc-release-materials', 'vb365-release-materials'].includes(item.id) ? { ...item, checkedAt: refreshedAt } : item,
)
for (const source of discoveredSources) {
  const index = merged.catalog.sources.findIndex((item) => item.id === source.id)
  if (index < 0) merged.catalog.sources.push(source)
  else merged.catalog.sources[index] = source
}

await validateThenInstall(merged.catalog)
console.log(`Catalog refresh complete: ${builds.length} VBR, ${oneBuilds.length} Veeam ONE, ${vroBuilds.length} VRO, ${vspcBuilds.length} VSPC, and ${vb365Builds.length} VB365 builds; ${buildsMerged.additions + oneBuildsMerged.additions + vroBuildsMerged.additions + vspcBuildsMerged.additions + vb365BuildsMerged.additions + enterpriseManagerBuildsMerged.additions} releases added; ${vb365PathsMerged.paths} VB365 documented routes; ${enterpriseManagerBuildsMerged.additions} Enterprise Manager build entries; ${releaseInformation12Merged.attachments + releaseInformationMerged.attachments} VBR release-information links; ${releaseMaterialsMerged.additions} release materials added, ${releaseMaterialsMerged.changes} changed, and ${highlightsMerged.additions} source-supported highlights added; ${lifecycleMerged.notices} lifecycle notices; ${vbrMerged.findings} VBR bulletin advisories; ${releaseSecurityMerged.findings} VBR/VSPC/VB365 release advisories from ${discoveredReleaseAdvisories.length} parseable security KBs; ${oneMerged.findings} Veeam ONE advisories; ${merged.matches} KEV matches.`)
