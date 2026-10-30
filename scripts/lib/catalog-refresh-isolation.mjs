import { readFile, readdir } from 'node:fs/promises'
import { buildCatalogCandidate } from '../catalog-refresh-candidate.mjs'
import { createCatalogSourceFetcher } from './source-fetch.mjs'
import { pinnedSecurityArticles, securityClassificationOverrides } from './catalog-refresh-registry.mjs'
import { assertSecurityFeedContinuity, assertSecurityFeedRouteContinuity, buildSecurityArticleClassifications, classifySecurityFeedArticles, extractSecurityArticleScope, extractCveIds, fetchSecurityFeedPages, fingerprintSecurityArticleContent } from './security-feed-coverage.mjs'
import { normalizeReviewedSecurityMainArticle } from './reviewed-security-advisories.mjs'
import { fetchVspcKbInventory } from './vspc-kb-cve-coverage.mjs'
import { parseCisaKev } from './cisa-kev.mjs'
import { parseLifecyclePolicies } from './lifecycle.mjs'
import { PRODUCT_IDS, PRODUCT_COLLECTIONS, assembleCatalog, createObservationCollector, hash, productPartition, sourceIdsForProduct, transactionClosure, validateCatalogProvenance } from './catalog-provenance.mjs'

const fail = (code, detail = '') => { throw Object.assign(new Error(code + (detail ? ': ' + detail : '')), { code }) }

export async function refreshPolicyHash() {
  const files = (await readdir(new URL('./', import.meta.url))).filter(name => name.endsWith('.mjs')).sort()
  return hash(await Promise.all([
    readFile(new URL('../catalog-refresh-candidate.mjs', import.meta.url), 'utf8'),
    ...files.map(name => readFile(new URL(name, import.meta.url), 'utf8')),
    readFile(new URL('../data/reviewed-security-advisories.json', import.meta.url), 'utf8'),
  ]))
}

export async function discoverTransactions({ current, baselines, collector, policyHash, reviewTexts }) {
  const globalFetcher = collector.forProducts(PRODUCT_IDS)
  const text = async (url, sourceId) => (await globalFetcher.request(url, { sourceId })).text()
  const source = id => {
    const found = current.sources.find(item => item.id === id)
    if (!found) fail('MISSING_GLOBAL_SOURCE', id)
    return found
  }
  const [feed, inventory, kev, lifecycle] = await Promise.all([
    fetchSecurityFeedPages({ minimumArticleCount: 46, fetchPage: ({ offset, limit }) => text('https://www.veeam.com/services/kb-articles?' + new URLSearchParams({ type: 'security', offset: String(offset), limit: String(limit) }), 'security-kb-' + offset) }),
    fetchVspcKbInventory({ minimumArticleCount: 69, fetchPage: ({ offset, limit }) => text('https://www.veeam.com/services/kb-articles?' + new URLSearchParams({ product: 'VAC', offset: String(offset), limit: String(limit) }), 'vspc-kb-inventory-' + offset) }),
    text(source('cisa-kev').url, 'cisa-kev'),
    text(source('lifecycle').url, 'lifecycle'),
  ])
  assertSecurityFeedContinuity(current.securityFeedArticleIds, feed.articles)
  if ((current.vspcKbArticleIds ?? []).some(id => !inventory.articles.some(article => article.id === id))) fail('VSPC_INVENTORY_TRUNCATED')
  const kevDocument = JSON.parse(kev)
  const kevCves = parseCisaKev(kevDocument)
  if (!kevCves.size || kevDocument.count !== kevDocument.vulnerabilities.length || kevCves.size !== kevDocument.count) fail('KEV_INVENTORY_INCOMPLETE')
  if (current.securityFindings.some(finding => finding.isCisaKev && !finding.cves.some(cve => kevCves.has(cve)))) fail('KEV_COVERAGE_REMOVED')
  const lifecyclePolicies = parseLifecyclePolicies(lifecycle)
  if (lifecyclePolicies.length < 10 || PRODUCT_IDS.filter(id => id !== 'enterprise-manager').some(id => !lifecyclePolicies.some(policy => policy.productId === id))) fail('LIFECYCLE_INCOMPLETE')
  const articles = [...feed.articles, ...pinnedSecurityArticles.filter(item => !feed.articles.some(article => article.id.toLowerCase() === item.id))]
  const classified = classifySecurityFeedArticles({ articles, classifications: buildSecurityArticleClassifications(articles, securityClassificationOverrides) })
  const unknown = classified.filter(article => article.classification === 'unclassified')
  if (unknown.length) fail('UNKNOWN_SOURCE_OWNERSHIP', unknown.map(item => item.articleId).join(','))
  const feedIds = new Set(feed.articles.map(article => article.id.toLowerCase()))
  assertSecurityFeedRouteContinuity(current.securityFeedRoutes, classified.filter(article => feedIds.has(article.articleId)).map(({ articleId, classification, productIds, multiProduct }) => ({ articleId, classification, productIds, multiProduct })))
  const edges = []
  if (current.refreshPolicyHash && current.refreshPolicyHash !== policyHash) edges.push(PRODUCT_IDS)
  const ownership = new Map()
  for (const article of classified) {
    const previous = current.securityFeedRoutes.find(route => route.articleId === article.articleId)
    const owners = new Set([...(previous?.productIds ?? []), ...article.productIds])
    for (const productId of PRODUCT_IDS) if (sourceIdsForProduct(current, productId).includes(article.articleId)) owners.add(productId)
    ownership.set(article.articleId, owners.size ? [...owners].sort() : PRODUCT_IDS)
  }
  // Global data revisions affect every transaction. An unavailable global
  // inventory already threw above; a changed one cannot evade a retained group.
  for (const observation of collector.observations.values()) {
    const prior = current.sourceRevisions?.filter(item => item.sourceId === observation.sourceId && item.kind === 'fetched')
    if (prior?.length && prior.some(item => item.digest !== observation.digest)) edges.push(PRODUCT_IDS)
  }
  await Promise.all(classified.map(async article => {
    const owners = ownership.get(article.articleId)
    const url = new URL(articles.find(item => item.id.toLowerCase() === article.articleId).url, 'https://www.veeam.com').toString()
    let html
    try { html = await (await collector.forProducts(owners).request(url, { sourceId: article.articleId })).text() }
    catch {
      edges.push(owners)
      if (owners.length === PRODUCT_IDS.length) fail('GLOBAL_SECURITY_SOURCE_UNAVAILABLE', article.articleId)
      return
    }
    const scope = extractSecurityArticleScope(html)
    const previous = current.securityFeedPageStates.find(state => state.articleId === article.articleId)
    if (previous && (JSON.stringify([...scope.productIds].sort()) !== JSON.stringify([...previous.productIds].sort()) || scope.hasOutOfScopeProduct !== previous.hasOutOfScopeProduct)) fail('UNKNOWN_SOURCE_SCOPE_CHANGE', article.articleId)
    reviewTexts[article.articleId] = normalizeReviewedSecurityMainArticle(html)
    const digest = fingerprintSecurityArticleContent(reviewTexts[article.articleId])
    if (baselines.articles[article.articleId]?.contentFingerprint !== digest) edges.push(owners)
  }))
  return transactionClosure(edges)
}

function failureCodes(error) {
  const findings = error.report?.findings ?? error.report?.failures ?? []
  const codes = findings.flatMap(item => typeof item.code === 'string' ? [item.code + (item.articleId ? ':' + item.articleId : '')] : [])
  return [...new Set(codes.length ? codes : [error.code ?? (error.name === 'CatalogSourceFetchError' ? 'SOURCE_FETCH_FAILED' : 'TRANSACTION_VALIDATION_FAILED')])].sort()
}

function normalizedPartition(catalog, productId) {
  const partition = productPartition(catalog, productId)
  for (const key of PRODUCT_COLLECTIONS) partition[key] = [...partition[key]].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  partition.securityFeedPageStates.sort((a,b) => a.articleId.localeCompare(b.articleId))
  return partition
}

export async function runTransactions({ current, baselines, collector, policyHash, groups, build = buildCatalogCandidate, reviewTexts = {}, atomic = false, shadow = true, now = () => new Date().toISOString() }) {
  const outcomes = []
  // One timestamp for the immutable composite. All sources must be collected
  // and validated in this run before this timestamp is accepted.
  const assembledAt = now()
  for (const productIds of groups) {
    try {
      const result = await build({ current, baselines, sourceFetcher: collector.forProducts(productIds), productIds, refreshedAt: assembledAt, reviewTexts })
      outcomes.push({ productIds, result })
    } catch (error) {
      const codes = failureCodes(error)
      const relevantSources = new Set(productIds.flatMap(id => sourceIdsForProduct(current, id)))
      for (const [articleId, text] of Object.entries(reviewTexts)) {
        if (!relevantSources.has(articleId)) continue
        const previousCves = new Set(extractCveIds(baselines.articles[articleId]?.normalizedText ?? ''))
        if (extractCveIds(text).some(cve => !previousCves.has(cve))) fail('UNCLASSIFIED_NEW_CVE_IN_FAILED_TRANSACTION', articleId)
      }
      // Unknown ownership/CVE scope is a global failure, never a partition skip.
      if (codes.some(code => /UNCLASSIFIED|UNKNOWN|SCOPE|PARSED_CVE_MISSING|UNSCOPED|TRAILING_CVE/.test(code))) throw error
      outcomes.push({ productIds, failureCodes: codes, error: String(error.message).slice(0,1200), reviewError: error })
    }
  }
  if (atomic && outcomes.some(outcome => !outcome.result)) fail('ATOMIC_REFRESH_BLOCKED')
  const assembled = assembleCatalog({ current, baselines, outcomes, observations: collector.observations, usage: collector.usage, policyHash, assembledAt })
  // Always compare a fully successful isolated refresh with the same adapters
  // run atomically over the same cached bytes. No second network observation.
  let shadowCompared = false
  if (shadow && outcomes.every(outcome => outcome.result)) {
    const oracle = await build({ current, baselines, sourceFetcher: collector.forProducts(PRODUCT_IDS), productIds: PRODUCT_IDS, refreshedAt: assembledAt, reviewTexts: {} })
    for (const id of PRODUCT_IDS) if (hash(normalizedPartition(oracle.catalog, id)) !== hash(normalizedPartition(assembled.catalog, id))) fail('ATOMIC_SHADOW_MISMATCH', id)
    if (hash(Object.entries(oracle.baselines.articles).sort()) !== hash(Object.entries(assembled.baselines.articles).sort())) fail('ATOMIC_BASELINE_MISMATCH')
    shadowCompared = true
  }
  const failed = outcomes.filter(outcome => !outcome.result)
  const reviewError = failed.length ? Object.assign(new Error('Partial refresh: ' + failed.map(item => item.productIds.join('+') + ': ' + item.error).join('; ')), { report: { findings: failed.flatMap(item => item.reviewError.report?.findings ?? [{ code: item.failureCodes[0], productIds: item.productIds }]) } }) : undefined
  return { ...assembled, reviewError,
    equivalentChanges: outcomes.flatMap(outcome => outcome.result?.equivalentChanges ?? []),
    inventoryChanges: outcomes.flatMap(outcome => outcome.result?.inventoryChanges ?? []),
    report: { status: outcomes.every(outcome => outcome.result) ? 'complete' : 'partial', assembledAt, shadowCompared, catalogHash: hash(assembled.catalog), baseCatalogHash: hash(current), policyHash, transactions: outcomes.map(({ productIds, failureCodes = [], error }) => ({ productIds, state: failureCodes.length ? 'retained' : 'validated', failureCodes, ...(error ? { error } : {}) })) },
  }
}

export async function refreshCatalog({ current, baselines, reviewTexts = {}, atomic = false }) {
  if (![1, 2].includes(current.schemaVersion)) fail('UNSUPPORTED_CATALOG_SCHEMA')
  if (current.schemaVersion === 2) validateCatalogProvenance(current)
  const policyHash = await refreshPolicyHash()
  const collector = createObservationCollector(createCatalogSourceFetcher())
  const groups = await discoverTransactions({ current, baselines, collector, policyHash, reviewTexts })
  return runTransactions({ current, baselines, collector, policyHash, groups, reviewTexts, atomic })
}

