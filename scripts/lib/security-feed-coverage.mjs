import { createHash } from 'node:crypto'

const KB_ID_PATTERN = /^kb\d+$/i
const CVE_ID_PATTERN = /^CVE-\d{4}-\d{4,}$/i
const ARTICLE_CLASSIFICATIONS = new Set(['parsed', 'dedicated', 'inventory', 'informational', 'out-of-scope', 'unclassified'])
const CONTENT_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/

export const INFORMATIONAL_CLASSIFICATION_REASONS = Object.freeze([
  'NO_VENDOR_VULNERABILITY_FINDING',
  'SUPERSEDED_BY_TRACKED_ADVISORY',
  'UNTRACKED_MANAGED_COMPONENT',
])

const INFORMATIONAL_REASONS = new Set(INFORMATIONAL_CLASSIFICATION_REASONS)

export const CATALOG_SECURITY_PRODUCTS = Object.freeze([
  Object.freeze({ id: 'vbr', aliases: Object.freeze(['Veeam Backup & Replication', 'VBR']) }),
  Object.freeze({ id: 'enterprise-manager', aliases: Object.freeze(['Veeam Backup Enterprise Manager', 'Veeam Enterprise Manager', 'Enterprise Manager']) }),
  Object.freeze({ id: 'veeam-one', aliases: Object.freeze(['Veeam ONE']) }),
  Object.freeze({ id: 'vro', aliases: Object.freeze(['Veeam Recovery Orchestrator', 'Veeam Availability Orchestrator', 'VRO']) }),
  Object.freeze({ id: 'vspc', aliases: Object.freeze(['Veeam Service Provider Console', 'VSPC']) }),
  Object.freeze({ id: 'vb365', aliases: Object.freeze(['Veeam Backup for Microsoft 365', 'Veeam Backup for Microsoft Office 365', 'VB365', 'VBO']) }),
])

export const OUT_OF_SCOPE_SECURITY_PRODUCT_ALIASES = Object.freeze([
  'Veeam Agent',
  'Veeam Agent for Linux',
  'Veeam Agent for Microsoft Windows',
  'Veeam Backup for AWS',
  'Veeam Backup for Google Cloud',
  'Veeam Backup for Microsoft Azure',
  'Veeam Backup for Nutanix AHV',
  'Veeam Backup for Oracle Linux Virtualization Manager and Red Hat Virtualization',
  'Veeam Backup for Salesforce',
  'Veeam Cloud Connect',
  'Veeam Management Pack for Microsoft System Center',
  'Veeam Plug-In for Microsoft Azure',
])

const PRODUCT_IDS = new Set(CATALOG_SECURITY_PRODUCTS.map((product) => product.id))
const SAFE_FINDING_CODES = new Set([
  'ARTICLE_FETCH_FAILED',
  'ARTICLE_CVE_OUTSIDE_VULNERABILITY_SCOPE',
  'ARTICLE_PAGE_INVALID',
  'ARTICLE_PAGE_MISSING',
  'ARTICLE_PRODUCT_SCOPE_CHANGED',
  'CATALOG_CVE_MISSING',
  'CATALOG_SOURCE_MISSING',
  'CLASSIFICATION_PRODUCT_REQUIRED',
  'FEED_ARTICLE_INVALID',
  'FEED_ARTICLE_DISAPPEARED',
  'FEED_ARTICLE_ROUTE_CHANGED',
  'FEED_DUPLICATE_ARTICLE',
  'FEED_PAGE_EMPTY',
  'FEED_PAGE_FETCH_FAILED',
  'FEED_PAGE_LIMIT_EXCEEDED',
  'FEED_PAYLOAD_INVALID',
  'FEED_TOTAL_BELOW_MINIMUM',
  'FEED_TOTAL_CHANGED',
  'FEED_TOTAL_MISMATCH',
  'INVALID_CLASSIFICATION',
  'INVALID_COVERAGE_INPUT',
  'INVENTORY_CATALOG_CVE_MISSING',
  'INVENTORY_PARSED_CVE_MISSING',
  'INFORMATIONAL_CONTENT_CHANGED',
  'INFORMATIONAL_CVE_OBSERVED',
  'MULTI_PRODUCT_ADAPTER_REQUIRED',
  'MULTI_PRODUCT_SCOPE_REQUIRED',
  'NO_CVES_OBSERVED',
  'PARSED_CVE_MISSING',
  'PARSED_SOURCE_MISSING',
  'PARTIAL_MULTI_PRODUCT_PARSE',
  'PARTIAL_PRODUCT_CLASSIFICATION',
  'SCOPED_CVE_NOT_OBSERVED',
  'REVIEWED_ARTICLE_CONTENT_CHANGED',
  'TRACKED_ARTICLE_MARKED_OUT_OF_SCOPE',
  'UNCLASSIFIED_SECURITY_ARTICLE',
  'UNSCOPED_MULTI_PRODUCT_CVE',
])

function normalizedText(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeKbId(value) {
  return typeof value === 'string' && KB_ID_PATTERN.test(value) ? value.toLowerCase() : undefined
}

function normalizeCveId(value) {
  return typeof value === 'string' && CVE_ID_PATTERN.test(value) ? value.toUpperCase() : undefined
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function sanitizeFinding(finding) {
  const safe = {
    code: SAFE_FINDING_CODES.has(finding?.code) ? finding.code : 'INVALID_COVERAGE_INPUT',
  }
  const articleId = normalizeKbId(finding?.articleId)
  if (articleId) safe.articleId = articleId
  const productIds = Array.isArray(finding?.productIds) ? sortedUnique(finding.productIds.filter((productId) => PRODUCT_IDS.has(productId))) : []
  if (productIds.length) safe.productIds = productIds
  const cveIds = Array.isArray(finding?.cveIds) ? sortedUnique(finding.cveIds.map(normalizeCveId).filter(Boolean)) : []
  if (cveIds.length) safe.cveIds = cveIds
  if (ARTICLE_CLASSIFICATIONS.has(finding?.classification)) safe.classification = finding.classification
  for (const key of ['actual', 'articleIndex', 'expected', 'offset', 'page']) {
    if (Number.isSafeInteger(finding?.[key]) && finding[key] >= 0) safe[key] = finding[key]
  }
  return safe
}

function compareFindings(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right))
}

export function createSecurityFeedCoverageReport(findings, { articleCount = 0 } = {}) {
  const safeFindings = (Array.isArray(findings) ? findings : [{ code: 'INVALID_COVERAGE_INPUT' }])
    .map(sanitizeFinding)
    .sort(compareFindings)
  const ok = safeFindings.length === 0
  const fingerprintPayload = JSON.stringify({ schemaVersion: 1, findings: safeFindings })
  return {
    schemaVersion: 1,
    ok,
    code: ok ? 'SECURITY_FEED_COVERAGE_OK' : 'SECURITY_FEED_COVERAGE_FAILED',
    articleCount: Number.isSafeInteger(articleCount) && articleCount >= 0 ? articleCount : 0,
    findingCount: safeFindings.length,
    findings: safeFindings,
    fingerprint: `sha256:${createHash('sha256').update(fingerprintPayload).digest('hex')}`,
  }
}

export function fingerprintSecurityArticleContent(content) {
  if (typeof content !== 'string') throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

export class SecurityFeedCoverageError extends Error {
  constructor(reportOrFindings, options = {}) {
    const report = Array.isArray(reportOrFindings)
      ? createSecurityFeedCoverageReport(reportOrFindings, options)
      : createSecurityFeedCoverageReport(reportOrFindings?.findings, { articleCount: reportOrFindings?.articleCount })
    super(`Security feed coverage failed with ${report.findingCount} finding(s); fingerprint ${report.fingerprint}.`)
    this.name = 'SecurityFeedCoverageError'
    this.code = report.code
    this.report = report
  }

  toJSON() {
    return this.report
  }
}

function throwCoverage(findings, options) {
  throw new SecurityFeedCoverageError(findings, options)
}

function normalizeFeedArticle(article, articleIndex) {
  const articleId = normalizeKbId(article?.id)
  if (!articleId || article?.type !== 'security' || typeof article?.url !== 'string') {
    throwCoverage([{ code: 'FEED_ARTICLE_INVALID', articleIndex }])
  }

  let articleUrl
  try {
    articleUrl = new URL(article.url, 'https://www.veeam.com')
  } catch {
    throwCoverage([{ code: 'FEED_ARTICLE_INVALID', articleId, articleIndex }])
  }
  const urlId = articleUrl.pathname.match(/^\/kb(\d+)\/?$/i)?.[1]
  if (!urlId || articleId !== `kb${urlId}`.toLowerCase() || !['veeam.com', 'www.veeam.com'].includes(articleUrl.hostname.toLowerCase())) {
    throwCoverage([{ code: 'FEED_ARTICLE_INVALID', articleId, articleIndex }])
  }

  if (article.product !== undefined && !Array.isArray(article.product)) {
    throwCoverage([{ code: 'FEED_ARTICLE_INVALID', articleId, articleIndex }])
  }
  const products = (article.product ?? []).map((product) => {
    if (!product || typeof product.title !== 'string') throwCoverage([{ code: 'FEED_ARTICLE_INVALID', articleId, articleIndex }])
    return product
  })
  return { ...article, id: articleId, product: products }
}

async function pagePayload(value) {
  if (typeof value === 'string') return JSON.parse(value)
  if (value && typeof value.json === 'function') return value.json()
  return value
}

export async function fetchSecurityFeedPages({ fetchPage, pageSize = 100, maxPages = 100, minimumArticleCount = 1 } = {}) {
  if (typeof fetchPage !== 'function' || !Number.isSafeInteger(pageSize) || pageSize < 1 || !Number.isSafeInteger(maxPages) || maxPages < 1 || !Number.isSafeInteger(minimumArticleCount) || minimumArticleCount < 1) {
    throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  }

  const articles = []
  const articleIds = new Set()
  let expectedTotal
  let offset = 0

  for (let page = 0; page < maxPages; page += 1) {
    let rawPayload
    try {
      rawPayload = await fetchPage({ offset, limit: pageSize, page })
    } catch {
      throwCoverage([{ code: 'FEED_PAGE_FETCH_FAILED', offset, page }], { articleCount: articles.length })
    }
    let payload
    try {
      payload = await pagePayload(rawPayload)
    } catch {
      throwCoverage([{ code: 'FEED_PAYLOAD_INVALID', offset, page }], { articleCount: articles.length })
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Number.isSafeInteger(payload.totalSize) || payload.totalSize < 0 || !Array.isArray(payload.articles) || payload.articles.length > pageSize) {
      throwCoverage([{ code: 'FEED_PAYLOAD_INVALID', offset, page }], { articleCount: articles.length })
    }
    if (expectedTotal === undefined) {
      expectedTotal = payload.totalSize
      if (expectedTotal < minimumArticleCount) {
        throwCoverage([{ code: 'FEED_TOTAL_BELOW_MINIMUM', actual: expectedTotal, expected: minimumArticleCount, offset, page }])
      }
    }
    if (payload.totalSize !== expectedTotal) {
      throwCoverage([{ code: 'FEED_TOTAL_CHANGED', actual: payload.totalSize, expected: expectedTotal, offset, page }], { articleCount: articles.length })
    }
    if (payload.articles.length === 0 && articles.length < expectedTotal) {
      throwCoverage([{ code: 'FEED_PAGE_EMPTY', actual: articles.length, expected: expectedTotal, offset, page }], { articleCount: articles.length })
    }

    for (const [index, rawArticle] of payload.articles.entries()) {
      const article = normalizeFeedArticle(rawArticle, offset + index)
      if (articleIds.has(article.id)) {
        throwCoverage([{ code: 'FEED_DUPLICATE_ARTICLE', articleId: article.id, articleIndex: offset + index }], { articleCount: articles.length })
      }
      articleIds.add(article.id)
      articles.push(article)
    }

    if (articles.length > expectedTotal) {
      throwCoverage([{ code: 'FEED_TOTAL_MISMATCH', actual: articles.length, expected: expectedTotal, offset, page }], { articleCount: articles.length })
    }
    if (articles.length === expectedTotal) return { totalSize: expectedTotal, articles, pageCount: page + 1 }
    offset = articles.length
  }

  throwCoverage([{ code: 'FEED_PAGE_LIMIT_EXCEEDED', actual: articles.length, expected: expectedTotal ?? 0, offset, page: maxPages }], { articleCount: articles.length })
}

export function assertSecurityFeedContinuity(previousArticleIds, articles) {
  if (!Array.isArray(articles)) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const currentArticleIds = articles.map((article, articleIndex) => {
    const articleId = normalizeKbId(article?.id)
    if (!articleId) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT', articleIndex }])
    return articleId
  })
  if (new Set(currentArticleIds).size !== currentArticleIds.length) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  if (previousArticleIds === undefined) return sortedUnique(currentArticleIds)
  if (!Array.isArray(previousArticleIds)) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const normalizedPrevious = previousArticleIds.map((articleId, articleIndex) => {
    const normalized = normalizeKbId(articleId)
    if (!normalized) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT', articleIndex }])
    return normalized
  })
  if (new Set(normalizedPrevious).size !== normalizedPrevious.length) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const current = new Set(currentArticleIds)
  const missing = normalizedPrevious.filter((articleId) => !current.has(articleId))
  if (missing.length) throwCoverage(missing.map((articleId) => ({ code: 'FEED_ARTICLE_DISAPPEARED', articleId })), { articleCount: currentArticleIds.length })
  return sortedUnique(currentArticleIds)
}

function normalizeRouteInventory(routes) {
  if (!Array.isArray(routes)) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const normalized = routes.map((route, articleIndex) => {
    const articleId = normalizeKbId(route?.articleId)
    const classification = route?.classification
    const productIds = route?.productIds
    if (!articleId || !ARTICLE_CLASSIFICATIONS.has(classification) || !Array.isArray(productIds) || productIds.some((productId) => !PRODUCT_IDS.has(productId)) || typeof route?.multiProduct !== 'boolean') {
      throwCoverage([{ code: 'INVALID_COVERAGE_INPUT', articleId, articleIndex }])
    }
    return { articleId, classification, productIds: sortedUnique(productIds), multiProduct: route.multiProduct }
  }).sort((left, right) => left.articleId.localeCompare(right.articleId))
  if (new Set(normalized.map((route) => route.articleId)).size !== normalized.length) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  return normalized
}

export function assertSecurityFeedRouteContinuity(previousRoutes, routes) {
  const current = normalizeRouteInventory(routes)
  if (previousRoutes === undefined) return current
  const previous = normalizeRouteInventory(previousRoutes)
  const currentById = new Map(current.map((route) => [route.articleId, route]))
  const changed = previous.filter((route) => {
    const next = currentById.get(route.articleId)
    return next && JSON.stringify(route) !== JSON.stringify(next)
  })
  if (changed.length) {
    throwCoverage(changed.map((route) => ({
      code: 'FEED_ARTICLE_ROUTE_CHANGED',
      articleId: route.articleId,
      productIds: currentById.get(route.articleId).productIds,
    })), { articleCount: current.length })
  }
  return current
}

function normalizePageStateInventory(states) {
  if (!Array.isArray(states)) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const normalized = states.map((state, articleIndex) => {
    const articleId = normalizeKbId(state?.articleId)
    const productIds = state?.productIds
    if (!articleId || !Array.isArray(productIds) || productIds.some((productId) => !PRODUCT_IDS.has(productId)) || typeof state?.hasOutOfScopeProduct !== 'boolean') {
      throwCoverage([{ code: 'INVALID_COVERAGE_INPUT', articleId, articleIndex }])
    }
    if (state.contentFingerprint !== undefined && (typeof state.contentFingerprint !== 'string' || !CONTENT_FINGERPRINT_PATTERN.test(state.contentFingerprint))) {
      throwCoverage([{ code: 'INVALID_COVERAGE_INPUT', articleId, articleIndex }])
    }
    const observedCveIds = state.observedCveIds === undefined
      ? undefined
      : normalizeCveList(state.observedCveIds, { code: 'INVALID_COVERAGE_INPUT', articleId, articleIndex })
    return {
      articleId,
      productIds: sortedUnique(productIds),
      hasOutOfScopeProduct: state.hasOutOfScopeProduct,
      ...(state.contentFingerprint ? { contentFingerprint: state.contentFingerprint } : {}),
      ...(observedCveIds ? { observedCveIds } : {}),
    }
  }).sort((left, right) => left.articleId.localeCompare(right.articleId))
  if (new Set(normalized.map((state) => state.articleId)).size !== normalized.length) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  return normalized
}

export function assertSecurityFeedPageStateContinuity(previousStates, states) {
  const current = normalizePageStateInventory(states)
  if (previousStates === undefined) return current
  const previous = normalizePageStateInventory(previousStates)
  const currentById = new Map(current.map((state) => [state.articleId, state]))
  const findings = []
  for (const state of previous) {
    const next = currentById.get(state.articleId)
    if (!next) {
      findings.push({ code: 'ARTICLE_FETCH_FAILED', articleId: state.articleId })
      continue
    }
    if (state.hasOutOfScopeProduct !== next.hasOutOfScopeProduct || JSON.stringify(state.productIds) !== JSON.stringify(next.productIds)) {
      findings.push({ code: 'ARTICLE_PRODUCT_SCOPE_CHANGED', articleId: state.articleId, productIds: next.productIds })
    }
    const inventoryExpanded = Array.isArray(state.observedCveIds) && Array.isArray(next.observedCveIds)
      && state.observedCveIds.every((cve) => next.observedCveIds.includes(cve))
      && next.observedCveIds.some((cve) => !state.observedCveIds.includes(cve))
    const inventoryStateBootstrap = state.contentFingerprint === undefined && state.observedCveIds === undefined
      && next.contentFingerprint !== undefined && Array.isArray(next.observedCveIds)
    if (state.contentFingerprint !== next.contentFingerprint && !inventoryExpanded && !inventoryStateBootstrap) {
      findings.push({ code: 'REVIEWED_ARTICLE_CONTENT_CHANGED', articleId: state.articleId })
    }
  }
  if (findings.length) throwCoverage(findings, { articleCount: current.length })
  return current
}

function classificationEntries(classifications) {
  if (classifications instanceof Map) return [...classifications.entries()]
  if (classifications && typeof classifications === 'object' && !Array.isArray(classifications)) return Object.entries(classifications)
  throwCoverage([{ code: 'INVALID_CLASSIFICATION' }])
}

function normalizeCveList(values, finding) {
  if (!Array.isArray(values) && !(values instanceof Set)) throwCoverage([finding])
  const normalized = [...values].map(normalizeCveId)
  if (normalized.some((value) => !value)) throwCoverage([finding])
  return sortedUnique(normalized)
}

function normalizeClassifications(classifications) {
  const routes = new Map()
  for (const [index, [rawArticleId, route]] of classificationEntries(classifications).entries()) {
    const articleId = normalizeKbId(rawArticleId)
    if (!articleId || !route || typeof route !== 'object' || !ARTICLE_CLASSIFICATIONS.has(route.classification)) {
      throwCoverage([{ code: 'INVALID_CLASSIFICATION', articleIndex: index }])
    }
    if (routes.has(articleId)) throwCoverage([{ code: 'INVALID_CLASSIFICATION', articleId, articleIndex: index }])
    let productIds
    if (route.productIds !== undefined) {
      if (!Array.isArray(route.productIds) || route.productIds.some((productId) => !PRODUCT_IDS.has(productId))) {
        throwCoverage([{ code: 'INVALID_CLASSIFICATION', articleId, articleIndex: index }])
      }
      productIds = sortedUnique(route.productIds)
    }
    if (route.classification === 'out-of-scope' && productIds?.length) {
      throwCoverage([{ code: 'INVALID_CLASSIFICATION', articleId, articleIndex: index }])
    }
    if (route.multiProduct !== undefined && typeof route.multiProduct !== 'boolean') {
      throwCoverage([{ code: 'INVALID_CLASSIFICATION', articleId, articleIndex: index }])
    }
    const ignoredCveIds = route.ignoredCveIds === undefined
      ? []
      : normalizeCveList(route.ignoredCveIds, { code: 'INVALID_CLASSIFICATION', articleId, articleIndex: index })
    const informationalReason = route.informationalReason
    const contentFingerprint = route.contentFingerprint
    if (route.classification === 'informational') {
      if (!INFORMATIONAL_REASONS.has(informationalReason) || typeof contentFingerprint !== 'string' || !CONTENT_FINGERPRINT_PATTERN.test(contentFingerprint)) {
        throwCoverage([{ code: 'INVALID_CLASSIFICATION', articleId, articleIndex: index }])
      }
    } else if (informationalReason !== undefined || contentFingerprint !== undefined) {
      throwCoverage([{ code: 'INVALID_CLASSIFICATION', articleId, articleIndex: index }])
    }
    routes.set(articleId, {
      classification: route.classification,
      productIds,
      ignoredCveIds,
      allowNoCves: route.allowNoCves === true,
      multiProduct: route.multiProduct,
      informationalReason,
      contentFingerprint,
    })
  }
  return routes
}

export function inferSecurityArticleProducts(article) {
  const metadataTitles = sortedUnique((article.product ?? []).map((product) => normalizedText(product.title)).filter(Boolean))
  const title = normalizedText(article.seoTitle)
  const outOfScopeAliases = OUT_OF_SCOPE_SECURITY_PRODUCT_ALIASES.map(normalizedText)
  const metadataProductIds = CATALOG_SECURITY_PRODUCTS.flatMap((product) => {
    const aliases = product.aliases.map(normalizedText)
    return aliases.some((alias) => metadataTitles.some((metadataTitle) => metadataTitle.includes(alias))) ? [product.id] : []
  })
  const titleProductIds = CATALOG_SECURITY_PRODUCTS.flatMap((product) => {
    const aliases = product.aliases.map(normalizedText)
    return aliases.some((alias) => title.includes(alias)) ? [product.id] : []
  })
  const productIds = titleProductIds.includes('enterprise-manager') && !titleProductIds.includes('vbr')
    ? sortedUnique([...metadataProductIds.filter((productId) => productId !== 'vbr'), ...titleProductIds])
    : sortedUnique([...metadataProductIds, ...titleProductIds])
  const outOfScopeMetadataTitles = metadataTitles.filter((metadataTitle) => outOfScopeAliases.some((alias) => metadataTitle.includes(alias)))
  const knownMetadataTitles = metadataTitles.filter((metadataTitle) => CATALOG_SECURITY_PRODUCTS.some((product) => product.aliases.map(normalizedText).some((alias) => metadataTitle.includes(alias))))
  const unknownMetadataTitles = metadataTitles.filter((metadataTitle) => !knownMetadataTitles.includes(metadataTitle) && !outOfScopeMetadataTitles.includes(metadataTitle))
  return {
    productIds,
    hasProductMetadata: metadataTitles.length > 0,
    hasOutOfScopeProductMetadata: outOfScopeMetadataTitles.length > 0,
    hasOutOfScopeProductTitle: outOfScopeAliases.some((alias) => title.includes(alias)),
    hasUnknownProductMetadata: unknownMetadataTitles.length > 0,
    metadataProductCount: metadataTitles.length,
  }
}

export function splitSecurityArticleVulnerabilityContent(content) {
  if (typeof content !== 'string') throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const articleStart = content.search(/<h1\b/i)
  let scopedContent = articleStart >= 0 ? content.slice(articleStart) : content
  const firstRawCve = scopedContent.search(/\bcve-\d{4}-\d{4,}\b/i)
  let sectionEndIndex
  if (firstRawCve >= 0) {
    const sectionEnd = [...scopedContent.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
      .find((heading) => heading.index > firstRawCve && /^(?:other resolved security-related issues|solution)$/i.test(normalizedText(heading[1])))
    if (sectionEnd) sectionEndIndex = sectionEnd.index
    else if (articleStart < 0) {
      const lower = scopedContent.toLowerCase()
      sectionEndIndex = ['other resolved security-related issues', 'solution']
        .map((marker) => lower.indexOf(marker, firstRawCve))
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0]
    }
  }
  return {
    vulnerabilityContent: sectionEndIndex === undefined ? scopedContent : scopedContent.slice(0, sectionEndIndex),
    trailingContent: sectionEndIndex === undefined ? '' : scopedContent.slice(sectionEndIndex),
  }
}

export function extractSecurityArticleScope(content) {
  const { vulnerabilityContent } = splitSecurityArticleVulnerabilityContent(content)
  const text = normalizedText(vulnerabilityContent.replace(/<(script|style|svg|form|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '))
  return {
    productIds: CATALOG_SECURITY_PRODUCTS.flatMap((product) => product.aliases.some((alias) => text.includes(normalizedText(alias))) ? [product.id] : []),
    hasOutOfScopeProduct: OUT_OF_SCOPE_SECURITY_PRODUCT_ALIASES.some((alias) => text.includes(normalizedText(alias))),
  }
}

export function extractSecurityArticleProductIds(content) {
  return extractSecurityArticleScope(content).productIds
}

export function buildSecurityArticleClassifications(articles, overrides = {}) {
  if (!Array.isArray(articles)) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const routes = new Map(classificationEntries(overrides))
  for (const [articleIndex, rawArticle] of articles.entries()) {
    const article = normalizeFeedArticle(rawArticle, articleIndex)
    if (routes.has(article.id)) continue
    const inferred = inferSecurityArticleProducts(article)
    if (!inferred.productIds.length || inferred.hasUnknownProductMetadata) continue
    routes.set(article.id, {
      classification: 'parsed',
      productIds: inferred.productIds,
      multiProduct: inferred.productIds.length > 1 || inferred.metadataProductCount > 1 || inferred.hasOutOfScopeProductMetadata || inferred.hasOutOfScopeProductTitle,
    })
  }
  return Object.fromEntries(routes)
}

export function classifySecurityFeedArticles({ articles, classifications = {} } = {}) {
  if (!Array.isArray(articles)) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const routes = normalizeClassifications(classifications)
  const articleIds = new Set()

  return articles.map((rawArticle, articleIndex) => {
    const article = normalizeFeedArticle(rawArticle, articleIndex)
    if (articleIds.has(article.id)) throwCoverage([{ code: 'FEED_DUPLICATE_ARTICLE', articleId: article.id, articleIndex }], { articleCount: articleIndex })
    articleIds.add(article.id)
    const inferred = inferSecurityArticleProducts(article)
    const route = routes.get(article.id)

    if (!route) {
      return {
        articleId: article.id,
        classification: 'unclassified',
        productIds: inferred.productIds,
        multiProduct: inferred.metadataProductCount > 1 || inferred.productIds.length > 1,
        reasonCode: 'UNCLASSIFIED_SECURITY_ARTICLE',
        ignoredCveIds: [],
        allowNoCves: false,
      }
    }

    if (route.classification === 'unclassified') {
      return { articleId: article.id, ...route, productIds: route.productIds ?? inferred.productIds, multiProduct: route.multiProduct || inferred.metadataProductCount > 1 || inferred.productIds.length > 1, reasonCode: 'UNCLASSIFIED_SECURITY_ARTICLE' }
    }
    if (route.classification === 'out-of-scope') {
      if (inferred.productIds.length) {
        return { articleId: article.id, ...route, classification: 'unclassified', productIds: inferred.productIds, multiProduct: route.multiProduct || inferred.metadataProductCount > 1 || inferred.productIds.length > 1, reasonCode: 'TRACKED_ARTICLE_MARKED_OUT_OF_SCOPE' }
      }
      return { articleId: article.id, ...route, productIds: [], multiProduct: route.multiProduct || inferred.metadataProductCount > 1 }
    }

    const productIds = route.productIds ?? inferred.productIds
    const missingProducts = inferred.productIds.filter((productId) => !productIds.includes(productId))
    const multiProduct = route.multiProduct ?? (inferred.metadataProductCount > 1 || productIds.length > 1 || inferred.hasOutOfScopeProductMetadata || inferred.hasOutOfScopeProductTitle || inferred.hasUnknownProductMetadata)
    if (productIds.length === 0) {
      return { articleId: article.id, ...route, classification: 'unclassified', productIds, multiProduct, reasonCode: 'CLASSIFICATION_PRODUCT_REQUIRED' }
    }
    if (missingProducts.length) {
      return { articleId: article.id, ...route, classification: 'unclassified', productIds: sortedUnique([...productIds, ...missingProducts]), multiProduct: true, reasonCode: 'PARTIAL_PRODUCT_CLASSIFICATION' }
    }
    if (route.classification === 'parsed' && multiProduct) {
      return { articleId: article.id, ...route, classification: 'unclassified', productIds, multiProduct, reasonCode: 'MULTI_PRODUCT_ADAPTER_REQUIRED' }
    }
    return { articleId: article.id, ...route, productIds, multiProduct }
  })
}

export function extractCveIds(content) {
  if (typeof content !== 'string') return []
  return sortedUnique([...content.matchAll(/\bCVE-\d{4}-\d{4,}\b/gi)].map((match) => match[0].toUpperCase()))
}

function informationalPageReview(article, articlePages, findings) {
  let page = keyedValue(articlePages, article.articleId)
  if (page?.status === 'fulfilled') page = page.value
  if (page instanceof Error || page?.status === 'rejected' || page?.error) {
    findings.push({ code: 'ARTICLE_FETCH_FAILED', articleId: article.articleId, productIds: article.productIds })
    return
  }
  if (page === undefined || page === null) {
    findings.push({ code: 'ARTICLE_PAGE_MISSING', articleId: article.articleId, productIds: article.productIds })
    return
  }

  let content
  let observedCves
  let suppliedFingerprint
  if (typeof page === 'string') {
    content = page
  } else if (typeof page === 'object' && !Array.isArray(page)) {
    content = typeof page.html === 'string' ? page.html : typeof page.content === 'string' ? page.content : undefined
    if (page.observedCves !== undefined) observedCves = normalizedObservationList(page.observedCves, article.articleId)
    suppliedFingerprint = page.contentFingerprint
    if (suppliedFingerprint !== undefined && (typeof suppliedFingerprint !== 'string' || !CONTENT_FINGERPRINT_PATTERN.test(suppliedFingerprint))) {
      throwCoverage([{ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId }])
    }
  } else {
    throwCoverage([{ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId }])
  }

  const actualFingerprint = content === undefined ? suppliedFingerprint : fingerprintSecurityArticleContent(content)
  if (!actualFingerprint) {
    findings.push({ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId, productIds: article.productIds })
    return
  }
  if (actualFingerprint !== article.contentFingerprint) {
    findings.push({ code: 'INFORMATIONAL_CONTENT_CHANGED', articleId: article.articleId, productIds: article.productIds })
  }

  const cves = observedCves ?? extractCveIds(content ?? '')
  const ignored = new Set(article.ignoredCveIds)
  const unexpected = cves.filter((cve) => !ignored.has(cve))
  if (unexpected.length) findings.push({ code: 'INFORMATIONAL_CVE_OBSERVED', articleId: article.articleId, productIds: article.productIds, cveIds: unexpected })
}

function outOfScopePageReview(article, articlePages, findings) {
  let page = keyedValue(articlePages, article.articleId)
  if (page?.status === 'fulfilled') page = page.value
  if (page instanceof Error || page?.status === 'rejected' || page?.error) {
    findings.push({ code: 'ARTICLE_FETCH_FAILED', articleId: article.articleId })
    return
  }
  if (page === undefined || page === null) {
    findings.push({ code: 'ARTICLE_PAGE_MISSING', articleId: article.articleId })
    return
  }
  const content = typeof page === 'string'
    ? page
    : typeof page === 'object' && !Array.isArray(page)
      ? typeof page.content === 'string' ? page.content : typeof page.html === 'string' ? page.html : undefined
      : undefined
  if (content === undefined) throwCoverage([{ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId }])
  const observed = typeof page === 'object' && !Array.isArray(page) && page.observedOutOfScopeProduct !== undefined
    ? page.observedOutOfScopeProduct
    : extractSecurityArticleScope(content).hasOutOfScopeProduct
  if (typeof observed !== 'boolean') throwCoverage([{ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId }])
  if (!observed) findings.push({ code: 'ARTICLE_PRODUCT_SCOPE_CHANGED', articleId: article.articleId })
}

function keyedValue(values, key) {
  if (values instanceof Map) return values.get(key)
  return values && typeof values === 'object' ? values[key] : undefined
}

function normalizedObservationList(values, articleId) {
  return normalizeCveList(values, { code: 'ARTICLE_PAGE_INVALID', articleId })
}

function articleObservations(article, articlePages, findings) {
  let page = keyedValue(articlePages, article.articleId)
  if (page?.status === 'fulfilled') page = page.value
  if (page instanceof Error || page?.status === 'rejected' || page?.error) {
    findings.push({ code: 'ARTICLE_FETCH_FAILED', articleId: article.articleId, productIds: article.productIds })
    return undefined
  }
  if (page === undefined || page === null) {
    findings.push({ code: 'ARTICLE_PAGE_MISSING', articleId: article.articleId, productIds: article.productIds })
    return undefined
  }

  let allCves
  let byProduct
  if (typeof page === 'string') {
    allCves = extractCveIds(page)
  } else if (typeof page === 'object' && !Array.isArray(page)) {
    const declaredCves = page.observedCves === undefined ? [] : normalizedObservationList(page.observedCves, article.articleId)
    const contentCves = typeof page.html === 'string'
      ? extractCveIds(page.html)
      : typeof page.content === 'string'
        ? extractCveIds(page.content)
        : []
    if (page.observedCves !== undefined || typeof page.html === 'string' || typeof page.content === 'string') allCves = sortedUnique([...declaredCves, ...contentCves])
    const trailingCveIds = page.trailingCveIds === undefined ? [] : normalizedObservationList(page.trailingCveIds, article.articleId)
    if (article.classification === 'parsed' && trailingCveIds.length) {
      findings.push({ code: 'ARTICLE_CVE_OUTSIDE_VULNERABILITY_SCOPE', articleId: article.articleId, productIds: article.productIds, cveIds: trailingCveIds })
    }

    const scope = extractSecurityArticleScope(typeof page.content === 'string' ? page.content : typeof page.html === 'string' ? page.html : '')
    const observedProductIds = page.observedProductIds === undefined
      ? scope.productIds
      : Array.isArray(page.observedProductIds) && page.observedProductIds.every((productId) => PRODUCT_IDS.has(productId))
        ? sortedUnique(page.observedProductIds)
        : undefined
    if (observedProductIds === undefined) throwCoverage([{ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId }])
    const observedOutOfScopeProduct = page.observedOutOfScopeProduct === undefined ? scope.hasOutOfScopeProduct : page.observedOutOfScopeProduct
    if (typeof observedOutOfScopeProduct !== 'boolean') throwCoverage([{ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId }])
    if (article.classification === 'parsed') {
      const unexpectedProductIds = observedProductIds.filter((productId) => !article.productIds.includes(productId))
      if (unexpectedProductIds.length || observedOutOfScopeProduct) findings.push({ code: 'ARTICLE_PRODUCT_SCOPE_CHANGED', articleId: article.articleId, productIds: unexpectedProductIds.length ? unexpectedProductIds : article.productIds })
    }

    if (page.observedCvesByProduct !== undefined) {
      const entries = page.observedCvesByProduct instanceof Map
        ? [...page.observedCvesByProduct.entries()]
        : page.observedCvesByProduct && typeof page.observedCvesByProduct === 'object' && !Array.isArray(page.observedCvesByProduct)
          ? Object.entries(page.observedCvesByProduct)
          : undefined
      if (!entries || entries.some(([productId]) => !PRODUCT_IDS.has(productId))) {
        throwCoverage([{ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId }])
      }
      byProduct = new Map(entries.map(([productId, values]) => [productId, normalizedObservationList(values, article.articleId)]))
    }
  } else {
    throwCoverage([{ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId }])
  }

  if (article.multiProduct) {
    if (!allCves || !byProduct) {
      findings.push({ code: 'MULTI_PRODUCT_SCOPE_REQUIRED', articleId: article.articleId, productIds: article.productIds })
      return undefined
    }
    const missingProducts = article.productIds.filter((productId) => !byProduct.has(productId))
    if (missingProducts.length) findings.push({ code: 'PARTIAL_MULTI_PRODUCT_PARSE', articleId: article.articleId, productIds: missingProducts })
    const scopedCves = sortedUnique(article.productIds.flatMap((productId) => byProduct.get(productId) ?? []))
    const ignored = new Set(article.ignoredCveIds)
    const unscoped = allCves.filter((cve) => !scopedCves.includes(cve) && !ignored.has(cve))
    const notObserved = scopedCves.filter((cve) => !allCves.includes(cve))
    if (unscoped.length) findings.push({ code: 'UNSCOPED_MULTI_PRODUCT_CVE', articleId: article.articleId, cveIds: unscoped })
    if (notObserved.length) findings.push({ code: 'SCOPED_CVE_NOT_OBSERVED', articleId: article.articleId, cveIds: notObserved })
    if (!allCves.length && !article.allowNoCves) findings.push({ code: 'NO_CVES_OBSERVED', articleId: article.articleId, productIds: article.productIds })
    return new Map(article.productIds.flatMap((productId) => byProduct.has(productId) ? [[productId, byProduct.get(productId)]] : []))
  }

  if (!allCves && byProduct && article.productIds.length === 1 && byProduct.has(article.productIds[0])) allCves = byProduct.get(article.productIds[0])
  if (!allCves) {
    findings.push({ code: 'ARTICLE_PAGE_INVALID', articleId: article.articleId, productIds: article.productIds })
    return undefined
  }
  if (!allCves.length && !article.allowNoCves) findings.push({ code: 'NO_CVES_OBSERVED', articleId: article.articleId, productIds: article.productIds })
  return new Map([[article.productIds[0], allCves]])
}

function coverageCves(record) {
  if (record?.cveIds !== undefined) return record.cveIds
  if (record?.cves !== undefined) return record.cves
  if (Array.isArray(record?.records)) return record.records.flatMap((item) => item?.cveIds ?? item?.cves ?? (item?.cve ? [item.cve] : []))
  return undefined
}

function addCoverage(index, anyByProduct, articleId, productId, cves) {
  const key = `${articleId}:${productId}`
  index.set(key, new Set([...(index.get(key) ?? []), ...cves]))
  anyByProduct.set(productId, new Set([...(anyByProduct.get(productId) ?? []), ...cves]))
}

function normalizedParsedCoverage(parsedCoverage) {
  if (!Array.isArray(parsedCoverage)) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const byArticleProduct = new Map()
  const anyByProduct = new Map()
  for (const [articleIndex, record] of parsedCoverage.entries()) {
    const articleId = normalizeKbId(record?.articleId ?? record?.sourceId ?? record?.source?.id)
    const productId = record?.productId
    const values = coverageCves(record)
    if (!articleId || !PRODUCT_IDS.has(productId) || values === undefined) {
      throwCoverage([{ code: 'INVALID_COVERAGE_INPUT', articleId, articleIndex }])
    }
    addCoverage(byArticleProduct, anyByProduct, articleId, productId, normalizeCveList(values, { code: 'INVALID_COVERAGE_INPUT', articleId, articleIndex }))
  }
  return { byArticleProduct, anyByProduct }
}

function normalizedCatalogCoverage(catalog) {
  const securityFindings = Array.isArray(catalog) ? catalog : catalog?.securityFindings
  if (!Array.isArray(securityFindings)) throwCoverage([{ code: 'INVALID_COVERAGE_INPUT' }])
  const byArticleProduct = new Map()
  const anyByProduct = new Map()
  for (const [articleIndex, finding] of securityFindings.entries()) {
    if (!PRODUCT_IDS.has(finding?.productId)) continue
    if (!Array.isArray(finding.sourceIds) || !Array.isArray(finding.cves)) {
      throwCoverage([{ code: 'INVALID_COVERAGE_INPUT', articleIndex }])
    }
    const cves = normalizeCveList(finding.cves, { code: 'INVALID_COVERAGE_INPUT', articleIndex })
    for (const articleId of finding.sourceIds.map(normalizeKbId).filter(Boolean)) {
      addCoverage(byArticleProduct, anyByProduct, articleId, finding.productId, cves)
    }
  }
  return { byArticleProduct, anyByProduct }
}

function missingCves(observed, accounted) {
  return observed.filter((cve) => !accounted?.has(cve))
}

export function inspectSecurityFeedCoverage({ articles, classifications = {}, articlePages = {}, parsedCoverage = [], catalog = { securityFindings: [] } } = {}) {
  const classifiedArticles = classifySecurityFeedArticles({ articles, classifications })
  const parsed = normalizedParsedCoverage(parsedCoverage)
  const catalogCoverage = normalizedCatalogCoverage(catalog)
  const findings = []

  for (const article of classifiedArticles) {
    if (article.classification === 'unclassified') {
      findings.push({ code: article.reasonCode ?? 'UNCLASSIFIED_SECURITY_ARTICLE', articleId: article.articleId, productIds: article.productIds, classification: article.classification })
      continue
    }
    if (article.classification === 'out-of-scope') {
      outOfScopePageReview(article, articlePages, findings)
      continue
    }
    if (article.classification === 'informational') {
      informationalPageReview(article, articlePages, findings)
      continue
    }

    const observations = articleObservations(article, articlePages, findings)
    if (!observations) continue
    const ignored = new Set(article.ignoredCveIds)

    for (const [productId, observedValues] of observations) {
      const observed = observedValues.filter((cve) => !ignored.has(cve))
      if (article.classification === 'inventory') {
        const unparsed = missingCves(observed, parsed.anyByProduct.get(productId))
        const uncataloged = missingCves(observed, catalogCoverage.anyByProduct.get(productId))
        if (unparsed.length) findings.push({ code: 'INVENTORY_PARSED_CVE_MISSING', articleId: article.articleId, productIds: [productId], cveIds: unparsed })
        if (uncataloged.length) findings.push({ code: 'INVENTORY_CATALOG_CVE_MISSING', articleId: article.articleId, productIds: [productId], cveIds: uncataloged })
        continue
      }

      const key = `${article.articleId}:${productId}`
      const parsedArticleCves = parsed.byArticleProduct.get(key)
      const catalogArticleCves = catalogCoverage.byArticleProduct.get(key)
      if (!parsedArticleCves) findings.push({ code: 'PARSED_SOURCE_MISSING', articleId: article.articleId, productIds: [productId], cveIds: observed })
      else {
        const unparsed = missingCves(observed, parsedArticleCves)
        if (unparsed.length) findings.push({ code: 'PARSED_CVE_MISSING', articleId: article.articleId, productIds: [productId], cveIds: unparsed })
      }
      if (!catalogArticleCves) findings.push({ code: 'CATALOG_SOURCE_MISSING', articleId: article.articleId, productIds: [productId], cveIds: observed })
      else {
        const uncataloged = missingCves(observed, catalogArticleCves)
        if (uncataloged.length) findings.push({ code: 'CATALOG_CVE_MISSING', articleId: article.articleId, productIds: [productId], cveIds: uncataloged })
      }
    }
  }

  const report = createSecurityFeedCoverageReport(findings, { articleCount: classifiedArticles.length })
  return {
    articles: classifiedArticles.map(({ reasonCode, ignoredCveIds, allowNoCves, ...article }) => article),
    report,
  }
}

export function assertSecurityFeedCoverage(options) {
  const result = inspectSecurityFeedCoverage(options)
  if (!result.report.ok) throw new SecurityFeedCoverageError(result.report)
  return result
}
