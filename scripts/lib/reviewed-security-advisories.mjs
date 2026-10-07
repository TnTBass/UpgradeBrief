import { createHash } from 'node:crypto'
import reviewedData from '../data/reviewed-security-advisories.json' with { type: 'json' }
import { validateReviewedSecurityData } from './reviewed-security-data.mjs'

const PRODUCT_PREFIX = Object.freeze({
  vbr: 'vbr',
  'enterprise-manager': 'em',
  'veeam-one': 'veeam-one',
  vro: 'vro',
})

// These records were moved without semantic changes; see migration-parity.json.
validateReviewedSecurityData(reviewedData)
export const REVIEWED_SECURITY_ADVISORIES = Object.freeze(reviewedData.advisories)
const observationSpecs = Object.freeze(reviewedData.observationSpecs)

const sortedUnique = (values) => [...new Set(values)].sort()

function decodeSemanticHtml(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity
    const numeric = code[1].toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10)
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity
  })
}

export function normalizeReviewedSecurityMainArticle(content) {
  if (typeof content !== 'string') throw new TypeError('Reviewed security article content must be a string.')
  const heading = content.search(/<h1\b/i)
  let scoped = heading >= 0 ? content.slice(heading) : content
  scoped = scoped
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|form|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:h[1-6]|p|li|div|section|article|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  let text = decodeSemanticHtml(scoped)
    .replace(/\r/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim()

  const endMarkers = [
    '\nRelated Articles',
    '\nThank you!',
    '\nKB Feedback/Suggestion',
    '\nSpelling error in text',
    '\nIf this KB article did not resolve this issue',
    '\nIf this KB article did not resolve your issue',
  ]
  const end = endMarkers.map((marker) => text.indexOf(marker)).filter((index) => index >= 0).sort((left, right) => left - right)[0]
  if (end !== undefined) text = text.slice(0, end)

  return text
    .replace(/\nGet weekly article updates[\s\S]*?\n(?:Veeam Software Security Commitment|General Vulnerability Details|Challenge|Issue Details|Purpose)\n/i, (match) => `\n${match.trim().split('\n').at(-1)}\n`)
    .replace(/\s+/g, ' ')
    .trim()
}

export function fingerprintReviewedSecurityMainArticle(content) {
  return `sha256:${createHash('sha256').update(normalizeReviewedSecurityMainArticle(content)).digest('hex')}`
}

export const REVIEWED_SECURITY_OBSERVATION_POLICY = Object.freeze(Object.fromEntries(
  Object.entries(observationSpecs).map(([articleId, spec]) => [articleId, Object.freeze({
    classification: spec.classification,
    productIds: Object.freeze(Object.keys(spec.productCves)),
    expectedCveIds: Object.freeze(sortedUnique([...Object.values(spec.productCves).flat(), ...(spec.ignoredCveIds ?? [])])),
    ignoredCveIds: Object.freeze(sortedUnique(spec.ignoredCveIds ?? [])),
    allowNoCves: spec.allowNoCves === true,
    multiProduct: spec.multiProduct === true,
    ...(spec.informationalReason ? { informationalReason: spec.informationalReason, contentFingerprint: spec.contentFingerprint } : {}),
    productCves: Object.freeze(Object.fromEntries(Object.entries(spec.productCves).map(([productId, cves]) => [productId, Object.freeze(sortedUnique(cves))]))),
  })]),
))

export const REVIEWED_SECURITY_CLASSIFICATIONS = Object.freeze(Object.fromEntries(
  Object.entries(REVIEWED_SECURITY_OBSERVATION_POLICY).map(([articleId, policy]) => [articleId, Object.freeze({
    classification: policy.classification,
    productIds: policy.productIds,
    ignoredCveIds: policy.ignoredCveIds,
    allowNoCves: policy.allowNoCves,
    multiProduct: policy.multiProduct,
    ...(policy.informationalReason ? { informationalReason: policy.informationalReason, contentFingerprint: policy.contentFingerprint } : {}),
  })]),
))

const advisoryCoverage = REVIEWED_SECURITY_ADVISORIES.map((advisory) => Object.freeze({
  articleId: advisory.articleId,
  productId: advisory.productId,
  cveIds: Object.freeze(advisory.records.flatMap((record) => record.cve ? [record.cve] : [])),
}))

export const REVIEWED_SECURITY_PARSED_COVERAGE = Object.freeze([
  ...advisoryCoverage,
  Object.freeze({ articleId: 'kb4857', productId: 'vro', cveIds: Object.freeze([]) }),
])

export const REVIEWED_SECURITY_SOURCE_COVERAGE = REVIEWED_SECURITY_PARSED_COVERAGE

export class ReviewedSecurityObservationError extends Error {
  constructor(articleId, missingCveIds, unexpectedCveIds) {
    const missing = missingCveIds.length ? ` missing=${missingCveIds.join(',')}` : ''
    const unexpected = unexpectedCveIds.length ? ` unexpected=${unexpectedCveIds.join(',')}` : ''
    super(`Reviewed security article ${articleId} changed.${missing}${unexpected}`)
    this.name = 'ReviewedSecurityObservationError'
    this.code = 'REVIEWED_SECURITY_ARTICLE_CHANGED'
    this.articleId = articleId
    this.missingCveIds = missingCveIds
    this.unexpectedCveIds = unexpectedCveIds
  }
}

export function extractReviewedSecurityCveIds(content) {
  if (typeof content !== 'string') throw new TypeError('Reviewed security article content must be a string.')
  return sortedUnique([...content.matchAll(/\bCVE\s*-?\s*(\d{4})\s*-?\s*(\d{4,7})\b/gi)]
    .map((match) => `CVE-${match[1]}-${match[2]}`))
}

export function observeReviewedSecurityArticle(articleId, content, { equivalentFingerprint } = {}) {
  const normalizedArticleId = String(articleId).toLowerCase()
  const policy = REVIEWED_SECURITY_OBSERVATION_POLICY[normalizedArticleId]
  if (!policy) throw new ReviewedSecurityObservationError(normalizedArticleId, [], [])

  const observedCves = extractReviewedSecurityCveIds(content)
  const missingCveIds = policy.expectedCveIds.filter((cve) => !observedCves.includes(cve))
  const unexpectedCveIds = observedCves.filter((cve) => !policy.expectedCveIds.includes(cve))
  const fingerprintChanged = policy.contentFingerprint
    ? fingerprintReviewedSecurityMainArticle(content) !== (equivalentFingerprint ?? policy.contentFingerprint)
    : false
  if (missingCveIds.length || unexpectedCveIds.length || fingerprintChanged) {
    throw new ReviewedSecurityObservationError(normalizedArticleId, missingCveIds, unexpectedCveIds)
  }

  return {
    observedCves,
    ...(policy.multiProduct ? { observedCvesByProduct: structuredClone(policy.productCves) } : {}),
  }
}

function findingFor(advisory, record, previousFinding) {
  const idPrefix = PRODUCT_PREFIX[advisory.productId]
  if (!idPrefix) throw new Error(`Unsupported reviewed security product: ${advisory.productId}`)
  const id = record.cve
    ? `${idPrefix}-${record.cve.toLowerCase()}`
    : `${idPrefix}-${advisory.articleId}-${record.key}`
  const conditions = [...(advisory.conditions ?? []), ...(record.conditions ?? [])]
  const sourceIds = [advisory.articleId]
  if (previousFinding?.isCisaKev && previousFinding.sourceIds?.includes('cisa-kev')) sourceIds.push('cisa-kev')

  return {
    id,
    productId: advisory.productId,
    title: record.title,
    cves: record.cve ? [record.cve] : [],
    affectedReleaseIds: [...(record.affectedReleaseIds ?? advisory.affectedReleaseIds ?? [])],
    ...(record.affectedVersionPrefixes ?? advisory.affectedVersionPrefixes ? { affectedVersionPrefixes: [...(record.affectedVersionPrefixes ?? advisory.affectedVersionPrefixes)] } : {}),
    ...(record.affectedBuildRanges ?? advisory.affectedBuildRanges ? { affectedBuildRanges: structuredClone(record.affectedBuildRanges ?? advisory.affectedBuildRanges) } : {}),
    ...(record.fixedReleaseId ?? advisory.fixedReleaseId ? { fixedReleaseId: record.fixedReleaseId ?? advisory.fixedReleaseId } : {}),
    ...(record.remediation ?? advisory.remediation ? { remediation: record.remediation ?? advisory.remediation } : {}),
    ...(Number.isFinite(record.cvssScore) ? { cvssScore: record.cvssScore } : {}),
    isCisaKev: previousFinding?.isCisaKev === true,
    conditions,
    sourceIds,
  }
}

export function mergeReviewedSecurityAdvisories(catalog, { checkedAt } = {}) {
  if (!catalog || !Array.isArray(catalog.securityFindings)) throw new TypeError('Catalog must include a securityFindings array.')
  if (catalog.sources !== undefined && !Array.isArray(catalog.sources)) throw new TypeError('Catalog sources must be an array when provided.')
  const next = structuredClone(catalog)
  next.sources ??= []

  const reviewedPairs = new Set(REVIEWED_SECURITY_ADVISORIES.map((advisory) => `${advisory.productId}:${advisory.articleId}`))
  const previousById = new Map(next.securityFindings.map((finding) => [finding.id, finding]))
  const retained = next.securityFindings.filter((finding) =>
    !(finding.sourceIds ?? []).some((sourceId) => reviewedPairs.has(`${finding.productId}:${sourceId}`)),
  )

  const findings = REVIEWED_SECURITY_ADVISORIES.flatMap((advisory) =>
    advisory.records.map((record) => findingFor(advisory, record, previousById.get(record.cve
      ? `${PRODUCT_PREFIX[advisory.productId]}-${record.cve.toLowerCase()}`
      : `${PRODUCT_PREFIX[advisory.productId]}-${advisory.articleId}-${record.key}`))),
  )
  const findingIds = findings.map((finding) => finding.id)
  if (new Set(findingIds).size !== findingIds.length) throw new Error('Reviewed security advisories produced duplicate finding IDs.')

  const releaseById = new Map((next.releases ?? []).map((release) => [release.id, release]))
  for (const finding of findings) {
    for (const releaseId of [...finding.affectedReleaseIds, ...(finding.fixedReleaseId ? [finding.fixedReleaseId] : [])]) {
      const release = releaseById.get(releaseId)
      if (!release || release.productId !== finding.productId) throw new Error(`${finding.id} references missing or cross-product release ${releaseId}.`)
    }
  }

  let sourceChanges = 0
  for (const advisory of REVIEWED_SECURITY_ADVISORIES) {
    const existingIndex = next.sources.findIndex((source) => source.id === advisory.source.id)
    const source = {
      ...(existingIndex >= 0 ? next.sources[existingIndex] : {}),
      ...advisory.source,
      ...(checkedAt ? { checkedAt } : {}),
    }
    if (existingIndex >= 0) next.sources[existingIndex] = source
    else next.sources.push(source)
    sourceChanges += 1
  }
  if (!next.sources.some((source) => source.id === 'kb4857')) {
    next.sources.push({
      id: 'kb4857',
      title: 'Veeam KB4857: List of Security Fixes and Improvements in Veeam Recovery Orchestrator',
      url: 'https://www.veeam.com/kb4857',
      ...(checkedAt ? { checkedAt } : {}),
    })
    sourceChanges += 1
  }

  next.securityFindings = [...retained, ...findings]
  return {
    catalog: next,
    findings: findings.length,
    replacedFindings: catalog.securityFindings.length - retained.length,
    sources: sourceChanges,
    parsedCoverage: structuredClone(REVIEWED_SECURITY_PARSED_COVERAGE),
  }
}
