import { createHash } from 'node:crypto'
import { exactKeys, requireCondition } from './reviewed-security-data.mjs'

export const REPAIR_SCHEMA_VERSION = 1
export const REPAIR_VALIDATOR_VERSION = '1-equivalence-only'
const HASH = /^sha256:[a-f0-9]{64}$/
const SHA = /^[a-f0-9]{40}$/

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  requireCondition(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)), 'non-JSON value')
  return JSON.stringify(value)
}

export const repairHash = value => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')}`

// Triage is not acceptance. Every unrecognized or mixed failure remains blocked.
export function classifyCatalogFailure(error) {
  const findings = error?.report?.findings
  if (Array.isArray(findings) && findings.length) {
    const kinds = [...new Set(findings.map(finding => {
      if (finding.code === 'REVIEWED_ARTICLE_CONTENT_CHANGED') return 'reviewed-content'
      if (['FEED_ARTICLE_ROUTE_CHANGED', 'ARTICLE_PRODUCT_SCOPE_CHANGED', 'CLASSIFICATION_PRODUCT_REQUIRED', 'UNCLASSIFIED_ARTICLE'].includes(finding.code)) return 'article-classification'
      if (finding.code === 'ARTICLE_FETCH_FAILED') return 'retrieval-investigation'
      return 'parser-or-coverage'
    }))].sort()
    return { categories: kinds, action: kinds.every(kind => ['reviewed-content', 'article-classification'].includes(kind)) ? 'prepare-evidence' : 'investigate', autoApply: false }
  }
  const message = String(error?.message ?? '')
  if (error?.diagnostic?.status === 403 || /request failed with HTTP 403\b/.test(message)) return { categories: ['http-access-refusal'], action: 'investigate', autoApply: false }
  if (/Help Center release-material discovery returned no current document/.test(message)) return { categories: ['empty-release-discovery'], action: 'bounded-refetch', autoApply: false }
  if (/Help Center release-material discovery returned a mismatched product/.test(message)) return { categories: ['mismatched-product'], action: 'investigate', autoApply: false }
  if ([408, 429, 500, 502, 503, 504].includes(error?.diagnostic?.status)) return { categories: ['transient-retrieval-exhausted'], action: 'investigate', autoApply: false }
  return { categories: [error ? 'unclassified-failure' : 'missing-diagnostics'], action: 'investigate', autoApply: false }
}

function evidenceIdentity(bundle) {
  return {
    schemaVersion: bundle.schemaVersion,
    policyFingerprint: bundle.policyFingerprint,
    validatorVersion: bundle.validatorVersion,
    articles: bundle.articles,
    failure: bundle.failure,
  }
}

export function createRepairEvidence({ report, baseCommit, policy, runId, capturedAt }) {
  requireCondition(report?.schemaVersion === 1 && Array.isArray(report.changes), 'missing source review report')
  requireCondition(report.ok === false && report.error, 'repair evidence must describe a failed refresh')
  const articles = report.changes.map(change => ({
    articleId: change.articleId,
    url: change.url,
    before: change.before,
    after: change.after,
    beforeHash: change.before === null ? null : repairHash(change.before),
    afterHash: repairHash(change.after),
    // Legacy normalized reports flatten headings. This is an honest whole-article
    // boundary, not a claimed vulnerability section. Semantic acceptance is off.
    sections: [{ id: 'article', start: 0, end: change.after.length }],
    acceptedPageState: change.acceptedPageState ?? null,
    acceptedRoute: change.acceptedRoute ?? null,
  })).sort((a, b) => a.articleId.localeCompare(b.articleId))
  const bundle = {
    schemaVersion: REPAIR_SCHEMA_VERSION,
    validatorVersion: REPAIR_VALIDATOR_VERSION,
    baseCommit,
    policyFingerprint: repairHash(policy),
    runId: String(runId),
    capturedAt,
    failure: structuredClone(report.error),
    articles,
  }
  bundle.evidenceId = repairHash(evidenceIdentity(bundle))
  return validateRepairEvidence(bundle)
}

export function validateRepairEvidence(bundle) {
  exactKeys(bundle, ['schemaVersion', 'validatorVersion', 'baseCommit', 'policyFingerprint', 'runId', 'capturedAt', 'failure', 'articles', 'evidenceId'], ['schemaVersion', 'validatorVersion', 'baseCommit', 'policyFingerprint', 'runId', 'capturedAt', 'failure', 'articles', 'evidenceId'], 'evidence')
  requireCondition(bundle.schemaVersion === REPAIR_SCHEMA_VERSION && bundle.validatorVersion === REPAIR_VALIDATOR_VERSION, 'unsupported evidence version')
  requireCondition(typeof bundle.baseCommit === 'string' && SHA.test(bundle.baseCommit), 'base commit')
  requireCondition(typeof bundle.policyFingerprint === 'string' && HASH.test(bundle.policyFingerprint), 'policy fingerprint')
  requireCondition(typeof bundle.runId === 'string' && /^\d+$/.test(bundle.runId), 'run ID')
  requireCondition(typeof bundle.capturedAt === 'string' && Number.isFinite(Date.parse(bundle.capturedAt)), 'capture time')
  requireCondition(bundle.failure && typeof bundle.failure.message === 'string', 'failure description')
  requireCondition(Array.isArray(bundle.articles) && bundle.articles.length <= 100, 'article list')
  const seen = new Set()
  for (const article of bundle.articles) {
    const keys = ['articleId', 'url', 'before', 'after', 'beforeHash', 'afterHash', 'sections', 'acceptedPageState', 'acceptedRoute']
    exactKeys(article, keys, keys, 'evidence article')
    requireCondition(typeof article.articleId === 'string' && /^kb\d+$/.test(article.articleId) && !seen.has(article.articleId), 'article identity')
    seen.add(article.articleId)
    requireCondition(article.url === `https://www.veeam.com/${article.articleId}`, 'source URL')
    requireCondition(article.before === null || (typeof article.before === 'string' && article.before.length > 0 && article.before.length <= 500_000), 'accepted text')
    requireCondition(typeof article.after === 'string' && article.after.trim().length > 0 && article.after.length <= 500_000, 'fetched text')
    requireCondition(article.beforeHash === (article.before === null ? null : repairHash(article.before)) && article.afterHash === repairHash(article.after), 'article text hash mismatch')
    requireCondition(canonicalJson(article.sections) === canonicalJson([{ id: 'article', start: 0, end: article.after.length }]), 'unsupported section boundaries')
  }
  requireCondition(bundle.evidenceId === repairHash(evidenceIdentity(bundle)), 'evidence identity mismatch')
  return bundle
}

export function validateRepairProposal(proposal, bundle) {
  validateRepairEvidence(bundle)
  exactKeys(proposal, ['schemaVersion', 'evidenceId', 'baseCommit', 'articles'], ['schemaVersion', 'evidenceId', 'baseCommit', 'articles'], 'proposal')
  requireCondition(proposal.schemaVersion === REPAIR_SCHEMA_VERSION && proposal.evidenceId === bundle.evidenceId && proposal.baseCommit === bundle.baseCommit, 'stale proposal')
  requireCondition(Array.isArray(proposal.articles) && proposal.articles.length === bundle.articles.length, 'proposal must account for every changed article')
  const seen = new Set()
  for (const proposalArticle of proposal.articles) {
    exactKeys(proposalArticle, ['articleId', 'kind', 'rationale', 'evidence', 'unresolved'], ['articleId', 'kind', 'rationale', 'evidence', 'unresolved'], 'proposal article')
    const article = bundle.articles.find(item => item.articleId === proposalArticle.articleId)
    requireCondition(article && !seen.has(article.articleId), 'unknown or repeated proposal article')
    seen.add(article.articleId)
    requireCondition(['equivalent', 'vulnerability', 'informational', 'classification'].includes(proposalArticle.kind), 'proposal variant')
    requireCondition(typeof proposalArticle.rationale === 'string' && proposalArticle.rationale.trim() && proposalArticle.rationale.length <= 4000, 'proposal rationale')
    requireCondition(Array.isArray(proposalArticle.unresolved) && proposalArticle.unresolved.length <= 100 && proposalArticle.unresolved.every(value => typeof value === 'string' && value.trim() && value.length <= 4000), 'unresolved claims')
    requireCondition(Array.isArray(proposalArticle.evidence) && proposalArticle.evidence.length > 0 && proposalArticle.evidence.length <= 100, 'evidence spans')
    for (const span of proposalArticle.evidence) {
      exactKeys(span, ['sectionId', 'start', 'end', 'quote'], ['sectionId', 'start', 'end', 'quote'], 'evidence span')
      const section = article.sections.find(item => item.id === span.sectionId)
      requireCondition(section && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end) && span.start >= section.start && span.end <= section.end && span.start < span.end, 'evidence span bounds')
      requireCondition(typeof span.quote === 'string' && article.after.slice(span.start, span.end) === span.quote, 'evidence quote mismatch')
    }
  }
  return proposal
}
