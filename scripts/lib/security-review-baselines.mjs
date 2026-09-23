import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fingerprintSecurityArticleContent } from './security-feed-coverage.mjs'

// Reviewed 2026-09-23 against the exact previously accepted article hashes.
// These are article-specific wording equivalences, not global product equivalences.
const namingRules = {
  kb4261: { metadata: ['Microsoft Azure'] },
  kb4374: { article: ['Google Cloud'] },
  kb4712: { article: ['AWS', 'Google Cloud'] },
  kb4924: { metadata: ['AWS'] },
}

function canonicalNames(text, clouds = []) {
  for (const cloud of clouds) {
    text = text.replace(new RegExp(`\\bVeeam (?:Backup|Plug-In) for ${cloud}\\b`, 'gi'), `Veeam Backup for ${cloud}`)
  }
  return text
}

export function normalizeSecurityReviewText(articleId, text) {
  const rule = namingRules[articleId] ?? {}
  // Only the labelled metadata date is ignored. Dates in guidance remain significant.
  text = text.replace(/^(.*? KB ID: \d+ Product: .*? Published: \d{4}-\d{2}-\d{2} Last Modified: )\d{4}-\d{2}-\d{2}\b/, '$1[recorded separately]')
  text = text.replace(/^(.*? KB ID: \d+ Product: )(.*?)( Published: \d{4}-\d{2}-\d{2}\b)/,
    (_, prefix, products, suffix) => prefix + canonicalNames(products, rule.metadata) + suffix)
  return canonicalNames(text, rule.article).replace(/\s+/g, ' ').trim()
}

export function createSecurityReviewBaseline(articleId, normalizedText, reviewedFingerprint) {
  return {
    normalizedText,
    contentFingerprint: fingerprintSecurityArticleContent(normalizedText),
    comparisonFingerprint: fingerprintSecurityArticleContent(normalizeSecurityReviewText(articleId, normalizedText)),
    ...(reviewedFingerprint ? { reviewedFingerprint } : {}),
  }
}

export function reconcileSecurityReviewBaselines({ baselines, previousStates, states, texts, policies = {} }) {
  if (baselines.schemaVersion !== 1) throw new Error('Unsupported security review baseline schema')
  const continuityStates = structuredClone(previousStates)
  const previousById = new Map(continuityStates.map(state => [state.articleId, state]))
  const acceptedFingerprints = {}
  const equivalentChanges = []
  const next = { schemaVersion: 1, articles: {} }
  for (const state of states) {
    const id = state.articleId
    const text = texts[id]
    if (typeof text !== 'string' || !text.trim()) throw new Error(`Missing article text for ${id}`)
    const baseline = baselines.articles[id]
    const previous = previousById.get(id)
    const policyFingerprint = policies[id]?.contentFingerprint
    let equivalent = false
    if (baseline) {
      const checked = createSecurityReviewBaseline(id, baseline.normalizedText, baseline.reviewedFingerprint)
      if (checked.contentFingerprint !== baseline.contentFingerprint || checked.comparisonFingerprint !== baseline.comparisonFingerprint
        || (previous?.contentFingerprint && previous.contentFingerprint !== baseline.contentFingerprint)
        || baseline.reviewedFingerprint !== policyFingerprint) {
        throw new Error(`Security review baseline is inconsistent for ${id}; review the baseline and catalogue together`)
      }
      equivalent = checked.comparisonFingerprint === fingerprintSecurityArticleContent(normalizeSecurityReviewText(id, text))
      if (equivalent && previous?.contentFingerprint) {
        // Only the text fingerprint is reconciled. Product scope, classification,
        // CVE inventory and all downstream coverage checks still run unchanged.
        previous.contentFingerprint = state.contentFingerprint
        if (baseline.contentFingerprint !== state.contentFingerprint) equivalentChanges.push(id)
        if (policyFingerprint) acceptedFingerprints[id] = state.contentFingerprint
      }
    }
    next.articles[id] = createSecurityReviewBaseline(id, text, policyFingerprint)
  }
  return { continuityStates, acceptedFingerprints, equivalentChanges, next }
}

// One exact changed span, with shared context, keeps reports readable without
// hiding any changed text. Full before/after text is retained in review.json.
export function changedTextSpan(before, after) {
  const left = before.split(/\s+/)
  const right = after.split(/\s+/)
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  let end = 0
  while (end < left.length - start && end < right.length - start && left[left.length - end - 1] === right[right.length - end - 1]) end++
  return {
    before: left.slice(Math.max(0, start - 12), Math.min(left.length, left.length - end + 12)).join(' '),
    after: right.slice(Math.max(0, start - 12), Math.min(right.length, right.length - end + 12)).join(' '),
  }
}

function escapeMarkdown(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]#|])/g, '\\$1')
}

export async function writeSecurityReviewReport({ directory, baselines, texts, catalog, error, equivalentChanges = [], summaryPath }) {
  const changes = Object.entries(texts).flatMap(([articleId, after]) => {
    const before = baselines.articles[articleId]?.normalizedText
    if (before === after) return []
    return [{
      articleId, url: `https://www.veeam.com/${articleId}`,
      disposition: before === undefined ? 'baseline-capture' : equivalentChanges.includes(articleId) ? 'approved-equivalence' : error ? 'review-required' : 'validated-refresh',
      acceptedPageState: catalog.securityFeedPageStates?.find(state => state.articleId === articleId),
      acceptedRoute: catalog.securityFeedRoutes?.find(route => route.articleId === articleId),
      affectedFindingIds: catalog.securityFindings.filter(f => f.sourceIds?.includes(articleId)).map(f => f.id),
      before: before ?? null, after,
      diff: before === undefined ? null : changedTextSpan(before, after),
    }]
  })
  const report = {
    schemaVersion: 1, ok: !error,
    ...(error ? { error: { message: error.message, code: error.code, report: error.report } } : {}),
    equivalentChanges, changes,
  }
  const lines = ['# Catalogue source review', '', error ? 'Refresh blocked. The previous catalogue and accepted baselines are retained.' : 'All catalogue checks passed.', '']
  if (error) lines.push(`Error: ${escapeMarkdown(error.message)}`, '')
  lines.push(`Approved wording/date changes: ${equivalentChanges.join(', ') || 'none'}.`, '')
  for (const change of changes.filter(c => c.disposition !== 'baseline-capture')) {
    lines.push(`## ${change.articleId}`, '', `Source: ${change.url}`, '', `Disposition: ${change.disposition}`, '',
      `Affected findings: ${change.affectedFindingIds.join(', ') || 'none; see article classification and scope in review.json'}`, '',
      `Before: ${escapeMarkdown(change.diff.before)}`, '', `After: ${escapeMarkdown(change.diff.after)}`, '')
  }
  if (changes.some(c => c.disposition === 'baseline-capture')) lines.push('First accepted text captures are included in review.json.', '')
  lines.push('Full accepted and fetched texts, changed spans, and structured gate findings are in review.json.', '')
  const markdown = lines.join('\n')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'review.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(join(directory, 'review.md'), markdown)
  if (summaryPath) await appendFile(summaryPath, markdown.length <= 500_000 ? markdown : 'Catalogue source review is available in the catalogue-source-review artifact.\n')
  return report
}
