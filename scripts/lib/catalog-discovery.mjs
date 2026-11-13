import { normalizeReviewedSecurityMainArticle } from './reviewed-security-advisories.mjs'
import { assertSecurityFeedRouteContinuity, extractSecurityArticleScope, fingerprintSecurityArticleContent } from './security-feed-coverage.mjs'
import { parseComponentAdvisory, supportedComponentTransition, reviewedComponentScope } from './component-advisory.mjs'
import { reconcileComponentScope } from './component-review.mjs'

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sorted = values => [...new Set(values)].sort()

export function discoveryError(findings) {
  return Object.assign(new Error(findings.map(f => f.code + ': ' + f.articleId).join('; ')), {
    code: findings[0].code, articleIds: sorted(findings.map(f => f.articleId)),
    report: { findings },
  })
}

export async function discoverArticleScopes({ classified, articles, current, baselines, collector, policies, reviewTexts, productIds }) {
  const edges = [], fatal = [], blocked = []
  // All fetches settle before a report is written. A rejected early page must
  // neither omit its own evidence nor race the remaining evidence collection.
  const fetched = await Promise.allSettled(classified.map(async article => {
    const articleId = article.articleId
    const previous = current.securityFeedPageStates.find(state => state.articleId === articleId)
    const route = current.securityFeedRoutes.find(state => state.articleId === articleId)
    const owners = sorted([...(route?.productIds ?? []), ...article.productIds, ...(current.sourceOwnership?.[articleId] ?? [])])
    const url = new URL(articles.find(item => item.id.toLowerCase() === articleId).url, 'https://www.veeam.com').toString()
    const html = await (await collector.forProducts(owners.length ? owners : productIds).request(url, { sourceId: articleId })).text()
    const text = normalizeReviewedSecurityMainArticle(html)
    reviewTexts[articleId] = text
    const scope = extractSecurityArticleScope(html)
    const model = parseComponentAdvisory(articleId, text)?.model
    const before = baselines.articles[articleId]?.normalizedText
    const oldModel = before ? parseComponentAdvisory(articleId, before)?.model : null
    const recognized = model && (!before || oldModel) && supportedComponentTransition(oldModel, model) &&
      equal(sorted(scope.productIds), sorted(model.productIds)) && scope.hasOutOfScopeProduct === true
    const affected = sorted([...owners, ...scope.productIds])
    const changedScope = previous && (!equal(sorted(previous.productIds), sorted(scope.productIds)) || previous.hasOutOfScopeProduct !== scope.hasOutOfScopeProduct)
    const approved = reviewedComponentScope({ articleId, text, previousText: before, policy: policies[articleId] })
    const unclassified = article.classification === 'unclassified'
    if (unclassified || (changedScope && !approved)) {
      const finding = { code: unclassified ? 'UNKNOWN_SOURCE_OWNERSHIP' : 'UNKNOWN_SOURCE_SCOPE_CHANGE', articleId,
        previousScope: previous ? { productIds: previous.productIds, hasOutOfScopeProduct: previous.hasOutOfScopeProduct } : null, observedScope: scope,
        productIds: affected }
      if (recognized && affected.length) {
        // New-advisory onboarding stays atomic; existing known product additions
        // can retain their dependency group while unrelated products advance.
        const dependency = unclassified ? productIds : affected
        edges.push(dependency)
        blocked.push({ ...finding, productIds: dependency, code: 'COMPONENT_ADVISORY_REVIEW_REQUIRED' })
      } else fatal.push(finding)
    }
    if (changedScope) edges.push(affected.length ? affected : productIds)
    if (baselines.articles[articleId]?.contentFingerprint !== fingerprintSecurityArticleContent(text)) edges.push(affected.length ? affected : productIds)
  }))
  for (const [i, result] of fetched.entries()) if (result.status === 'rejected') {
    const article = classified[i]
    const owners = sorted([...(current.sourceOwnership?.[article.articleId] ?? []), ...article.productIds])
    const finding = { code: 'ARTICLE_FETCH_FAILED', articleId: article.articleId, productIds: owners, diagnostic: result.reason?.diagnostic }
    if (!owners.length || article.classification === 'unclassified') fatal.push(finding)
    else { edges.push(owners); blocked.push(finding) }
  }
  const reviewed = reconcileComponentScope({ routes: current.securityFeedRoutes, pageStates: current.securityFeedPageStates, baselines, texts: reviewTexts, policies })
  const feedIds = new Set(articles.map(a => a.id.toLowerCase()))
  try {
    assertSecurityFeedRouteContinuity(reviewed.routes, classified.filter(a => feedIds.has(a.articleId))
      .map(({ articleId, classification, productIds, multiProduct }) => ({ articleId, classification, productIds, multiProduct })))
  } catch (error) { fatal.push(...(error.report?.findings ?? [{ code: 'FEED_ARTICLE_ROUTE_CHANGED', articleId: 'unknown' }])) }
  if (fatal.length) throw discoveryError(fatal)
  return { edges, blocked }
}

