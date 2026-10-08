import { canonicalJson, classifyCatalogFailure, repairHash, validateRepairEvidence, validateRepairProposal } from './catalog-repair-evidence.mjs'
import { requireCondition, validateReviewedSecurityData } from './reviewed-security-data.mjs'
import { createSecurityReviewBaseline, normalizeSecurityReviewText } from './security-review-baselines.mjs'
import { applySemanticChange } from './catalog-repair-semantics.mjs'

export const REPAIR_OUTPUT_PATHS = Object.freeze([
  'scripts/data/reviewed-security-advisories.json',
  'scripts/data/security-review-baselines.json',
  'src/data/catalog.snapshot.json',
])

// Pure candidate construction: this module never writes files or accepts paths.
// It cannot authorize publication; full catalog validation and fresh-source
// verification must still run on an isolated checkout in the publication phase.
export function buildRepairCandidate({ bundle, proposal, reviewedData, baselines, catalog, currentCommit, holds = [], extractions = {} }) {
  validateRepairEvidence(bundle)
  validateRepairProposal(proposal, bundle)
  validateReviewedSecurityData(reviewedData)
  requireCondition(currentCommit === bundle.baseCommit, 'base commit changed; regenerate the proposal')
  requireCondition(bundle.policyFingerprint === repairHash(reviewedData), 'review policy changed')
  requireCondition(baselines?.schemaVersion === 1 && baselines.articles, 'baseline schema')
  requireCondition(Array.isArray(catalog.securityFeedPageStates) && Array.isArray(catalog.securityFeedRoutes), 'catalog continuity state')
  requireCondition(Array.isArray(holds) && holds.every(id => typeof id === 'string'), 'repair holds')
  const blocked = []
  if (holds.includes(bundle.evidenceId) || bundle.articles.some(article => holds.includes(article.articleId))) blocked.push({ code: 'REVIEW_CHANGE_REQUEST_HOLD' })
  const triage = classifyCatalogFailure(bundle.failure)
  if (triage.categories.some(category => category !== 'reviewed-content')) blocked.push({ code: 'UNSUPPORTED_FAILURE', categories: triage.categories })
  if (!bundle.articles.length) blocked.push({ code: 'MISSING_SOURCE_EVIDENCE' })
  const articleIds = new Set(bundle.articles.map(article => article.articleId))
  for (const finding of bundle.failure.report?.findings ?? []) {
    if (!articleIds.has(finding.articleId)) blocked.push({ code: 'MISSING_FINDING_EVIDENCE', articleId: finding.articleId ?? null })
  }
  let nextData = structuredClone(reviewedData)
  const semanticChecks = []
  const nextBaselines = structuredClone(baselines)
  const nextCatalog = structuredClone(catalog)
  for (const article of bundle.articles) {
    const proposed = proposal.articles.find(item => item.articleId === article.articleId)
    const before = baselines.articles[article.articleId]
    const page = catalog.securityFeedPageStates.find(item => item.articleId === article.articleId)
    const route = catalog.securityFeedRoutes.find(item => item.articleId === article.articleId) ?? null
    // KB4857 is explicitly reviewed and fetched as a supplemental source, even
    // when it is absent from the current feed. Preserve that absence; do not
    // manufacture a feed route or broaden classification policy.
    const supplemental = article.articleId === 'kb4857' && reviewedData.observationSpecs.kb4857?.classification === 'informational'
      && Array.isArray(catalog.securityFeedArticleIds) && !catalog.securityFeedArticleIds.includes(article.articleId)
    if (!before || !page || (!route && !supplemental) || article.before === null) {
      blocked.push({ code: 'NEW_ARTICLE_REQUIRES_CLASSIFICATION', articleId: article.articleId })
      continue
    }
    const oldPolicyFingerprint = reviewedData.observationSpecs[article.articleId]?.contentFingerprint
    const checked = createSecurityReviewBaseline(article.articleId, before.normalizedText, before.reviewedFingerprint)
    requireCondition(canonicalJson(before) === canonicalJson(checked), `${article.articleId} has an inconsistent baseline`)
    requireCondition(before.normalizedText === article.before && before.contentFingerprint === article.beforeHash && page.contentFingerprint === article.beforeHash, `${article.articleId} accepted text changed`)
    requireCondition(before.reviewedFingerprint === oldPolicyFingerprint, `${article.articleId} accepted policy changed`)
    requireCondition(canonicalJson(page) === canonicalJson(article.acceptedPageState) && canonicalJson(route) === canonicalJson(article.acceptedRoute), `${article.articleId} accepted scope changed`)
    if (proposed.unresolved.length) blocked.push({ code: 'UNRESOLVED_CLAIMS', articleId: article.articleId })
    if (proposed.kind !== 'equivalent') {
      const semantic = applySemanticChange({ article, reviewedData: nextData, extraction: extractions[article.articleId] })
      if (!semantic || semantic.kind !== proposed.kind) {
        blocked.push({ code: 'SEMANTIC_ADAPTER_REQUIRED', articleId: article.articleId, kind: proposed.kind })
        continue
      }
      nextData = semantic.reviewedData
      semanticChecks.push(...semantic.checks)
    } else if (normalizeSecurityReviewText(article.articleId, article.before) !== normalizeSecurityReviewText(article.articleId, article.after)) {
      blocked.push({ code: 'UNSUPPORTED_SEMANTIC_CHANGE', articleId: article.articleId })
      continue
    }
    const spec = nextData.observationSpecs[article.articleId]
    if (spec?.contentFingerprint) spec.contentFingerprint = article.afterHash
    nextBaselines.articles[article.articleId] = createSecurityReviewBaseline(article.articleId, article.after, spec?.contentFingerprint)
    nextCatalog.securityFeedPageStates.find(item => item.articleId === article.articleId).contentFingerprint = article.afterHash
  }
  const result = {
    schemaVersion: 1,
    evidenceId: bundle.evidenceId,
    baseCommit: bundle.baseCommit,
    status: blocked.length ? 'blocked' : 'candidate-ready',
    eligibleForPublication: false,
    blocked,
    checks: {
      passed: ['evidence-integrity', 'proposal-schema', 'base-and-policy-continuity'],
      notRun: ['full-catalog-validation', 'live-refresh', 'fresh-source-verification', 'github-checks', 'publication', 'notification-delivery'],
    },
    files: {},
  }
  // Never return a partial candidate when any article is unresolved.
  if (!blocked.length) {
    validateReviewedSecurityData(nextData)
    result.checks.passed.push(...new Set(semanticChecks.length ? semanticChecks : ['maintained-wording-equivalence']), 'candidate-data-schema')
    for (const [path, next, previous] of [
      [REPAIR_OUTPUT_PATHS[0], nextData, reviewedData],
      [REPAIR_OUTPUT_PATHS[1], nextBaselines, baselines],
      [REPAIR_OUTPUT_PATHS[2], nextCatalog, catalog],
    ]) if (canonicalJson(next) !== canonicalJson(previous)) result.files[path] = `${JSON.stringify(next, null, 2)}\n`
  }
  return result
}

const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]#|])/g, '\\$1').replace(/@/g, '&#64;')

export function renderRepairBrief(bundle, result) {
  const lines = [
    '# Catalog repair review', '',
    `Status: **${escape(result.status)}**. Publication is not authorized by this offline result.`, '',
    `Base commit: \`${bundle.baseCommit}\``,
    `Evidence: \`${bundle.evidenceId}\``,
    `Failed run: https://github.com/TnTBass/UpgradeBrief/actions/runs/${bundle.runId}`, '',
    '## What changed and the approach', '',
    'The candidate builder accepts maintained article-specific wording equivalences, supported dependency-note updates, and strictly validated additions to existing advisory structures. An AI explanation cannot authorize acceptance.', '',
  ]
  for (const article of bundle.articles) lines.push(`- ${article.articleId}: ${article.url}; accepted ${article.beforeHash ?? 'none'}; fetched ${article.afterHash}.`)
  lines.push('', '## Validation', '', `Passed: ${result.checks.passed.join(', ')}.`, `Not run: ${result.checks.notRun.join(', ')}.`, '')
  for (const finding of result.blocked) lines.push(`- ${escape(finding.articleId ?? 'Bundle')}: ${escape(finding.code)}.`)
  lines.push('', 'Full before/after source text and proposal evidence are saved beside this brief. Review the exact base and evidence IDs. You can flag a concern in ordinary language; the receiving assistant must link it to this repair. Automated feedback intake is not active in this offline stage.', '')
  return lines.join('\n')
}
