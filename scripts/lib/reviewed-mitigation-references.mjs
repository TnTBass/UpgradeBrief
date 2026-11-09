import { normalizeSecurityReviewText } from './security-review-baselines.mjs'
import { normalizeReviewedSecurityMainArticle } from './reviewed-security-advisories.mjs'
import { fingerprintSecurityArticleContent } from './security-feed-coverage.mjs'

// Reviewed October 30: KB4853 repeats its already parsed alarm-script CVE in
// mitigation guidance. Accept only this complete reviewed text (apart from the
// labelled modification date). Unknown trailing CVEs or guidance remain errors.
export function unreviewedTrailingCveIds(articleId, content, cveIds) {
  if (articleId !== 'kb4853') return cveIds
  const text = normalizeSecurityReviewText(articleId, normalizeReviewedSecurityMainArticle(content))
  if (fingerprintSecurityArticleContent(text) !== 'sha256:c2f0cb9801c9eba757dfba4aa259e57e9d81bff184cb27be03e6eb3fc219234c') return cveIds
  return cveIds.filter(cve => cve !== 'CVE-2026-32998')
}
