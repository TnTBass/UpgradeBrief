import { PRODUCT_IDS, PRODUCT_COLLECTIONS, hash, sourceIdsForProduct, transactionClosure, validateCatalogProvenance } from './catalog-provenance.mjs'

export function captureProductRollback({ catalog, baselines }, articleIds) {
  if (catalog.schemaVersion !== 2) return undefined
  const owners = PRODUCT_IDS.filter(id => sourceIdsForProduct(catalog, id).some(sourceId => articleIds.includes(sourceId)))
  if (!owners.length) throw new Error('Cannot capture rollback with unknown source ownership')
  const groups = transactionClosure([owners])
  const productIds = groups.find(group => group.some(id => owners.includes(id)))
  const sources = new Set(productIds.flatMap(id => sourceIdsForProduct(catalog, id)))
  const validations = catalog.productValidation.filter(item => productIds.includes(item.productId))
  const evidenceIds = new Set(validations.flatMap(item => item.evidenceIds))
  return {
    productIds,
    products: catalog.products.filter(item => productIds.includes(item.id)),
    collections: Object.fromEntries(PRODUCT_COLLECTIONS.map(key => [key, catalog[key].filter(item => productIds.includes(item.productId))])),
    pageStates: catalog.securityFeedPageStates.filter(item => sources.has(item.articleId)),
    routes: catalog.securityFeedRoutes.filter(item => sources.has(item.articleId)),
    sources: catalog.sources.filter(item => sources.has(item.id)),
    baselines: Object.fromEntries([...sources].filter(id => baselines.articles[id]).map(id => [id, baselines.articles[id]])),
    productValidation: validations,
    sourceRevisions: catalog.sourceRevisions.filter(item => evidenceIds.has(item.id)).map(item => ({ ...item, validatedConsumers: item.validatedConsumers.filter(id => productIds.includes(id)) })),
    ...(productIds.includes('vspc') ? { vspc: Object.fromEntries(['vspcKbArticleIds', 'vspcKbCvePageStates', 'vspcCveRecordStates'].map(key => [key, catalog[key]])) } : {}),
  }
}

export function restoreProductRollback(next, before, after, now = new Date().toISOString()) {
  if (!before || !after || hash(before.productIds) !== hash(after.productIds)) throw new Error('Cannot revert schema-2 data without complete matching product provenance')
  const ids = new Set(before.productIds)
  for (const key of PRODUCT_COLLECTIONS) {
    const remaining = next.catalog[key].filter(item => !ids.has(item.productId))
    next.catalog[key] = PRODUCT_IDS.flatMap(id => [...remaining, ...before.collections[key]].filter(item => item.productId === id))
  }
  next.catalog.products = PRODUCT_IDS.map(id => ids.has(id) ? before.products.find(item => item.id === id) : next.catalog.products.find(item => item.id === id))
  const sourceIds = new Set([...before.sources, ...after.sources].map(item => item.id))
  const pageIds = new Set([...before.pageStates, ...after.pageStates].map(item => item.articleId))
  next.catalog.sources = [...next.catalog.sources.filter(item => !sourceIds.has(item.id)), ...before.sources]
  next.catalog.securityFeedPageStates = [...next.catalog.securityFeedPageStates.filter(item => !pageIds.has(item.articleId)), ...before.pageStates].sort((a,b) => a.articleId.localeCompare(b.articleId))
  const routeIds = new Set([...before.routes, ...after.routes].map(item => item.articleId))
  next.catalog.securityFeedRoutes = [...next.catalog.securityFeedRoutes.filter(item => !routeIds.has(item.articleId)), ...before.routes]
  for (const key of Object.keys(after.baselines)) delete next.baselines.articles[key]
  Object.assign(next.baselines.articles, structuredClone(before.baselines))
  if (before.vspc) Object.assign(next.catalog, structuredClone(before.vspc))
  next.catalog.productValidation = PRODUCT_IDS.map(id => {
    if (!ids.has(id)) return next.catalog.productValidation.find(item => item.productId === id)
    return { ...before.productValidation.find(item => item.productId === id), attemptedAt: now, state: 'retained', failureCodes: ['REVIEWER_REQUESTED_ROLLBACK'] }
  })
  const revisions = new Map(next.catalog.sourceRevisions.map(item => [item.id, { ...item, validatedConsumers: item.validatedConsumers.filter(id => !ids.has(id)) }]))
  for (const item of before.sourceRevisions) {
    const existing = revisions.get(item.id)
    revisions.set(item.id, { ...item, validatedConsumers: [...new Set([...(existing?.validatedConsumers ?? []), ...item.validatedConsumers])].sort() })
  }
  next.catalog.sourceRevisions = [...revisions.values()].filter(item => item.validatedConsumers.length).sort((a,b) => a.id.localeCompare(b.id))
  next.catalog.assembledAt = now
  next.catalog.generatedAt = next.catalog.productValidation.map(item => item.validatedAt).sort()[0]
  // The accepted hashes must still match: rollback never manufactures a newer
  // validation or recomputes an old hash over a mixture of old and new records.
  validateCatalogProvenance(next.catalog)
  return next
}

