import { parseComponentAdvisory, reviewedComponentScope } from './component-advisory.mjs'

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

// Adjust comparison inputs only. Accepted data and provenance are never edited.
// Publication still rebuilds every affected partition from fresh source evidence.
export function reconcileComponentScope({ routes, pageStates, baselines, texts, policies }) {
  const nextRoutes = structuredClone(routes), nextStates = structuredClone(pageStates)
  for (const [articleId, text] of Object.entries(texts)) {
    const previousText = baselines.articles[articleId]?.normalizedText
    const scope = reviewedComponentScope({ articleId, text, previousText, policy: policies[articleId] })
    if (!scope) continue
    const before = previousText && parseComponentAdvisory(articleId, previousText)?.model
    const state = nextStates.find(item => item.articleId === articleId)
    const route = nextRoutes.find(item => item.articleId === articleId)
    if (before && state && route && state.hasOutOfScopeProduct === true && route.classification === 'dedicated' && route.multiProduct === true &&
      sameIds(state.productIds, before.productIds) && sameIds(route.productIds, before.productIds)) {
      state.productIds = [...scope.productIds]
      route.productIds = [...scope.productIds]
    }
  }
  return { routes: nextRoutes, pageStates: nextStates }
}

