import { createHash } from 'node:crypto'

export const PRODUCT_IDS = ['vbr', 'enterprise-manager', 'veeam-one', 'vro', 'vspc', 'vb365']
export const BASE_TRANSACTIONS = [['vbr', 'enterprise-manager'], ['veeam-one', 'vro'], ['vspc'], ['vb365']]
export const PRODUCT_COLLECTIONS = ['releases', 'lifecycleNotices', 'upgradePaths', 'securityFindings', 'operationalNotices', 'releaseImprovements', 'capabilities']
export const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sorted = values => [...new Set(values)].sort()
const invariant = (ok, message) => { if (!ok) throw new Error(message) }

export function sourceIdsForProduct(catalog, productId) {
  const ids = new Set(['security-kb', 'cisa-kev', 'lifecycle'])
  function visit(value) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (['sourceIds', 'howToSourceIds'].includes(key)) for (const id of child) ids.add(id)
      else if (typeof child === 'object') visit(child)
    }
  }
  for (const key of PRODUCT_COLLECTIONS) visit((catalog[key] ?? []).filter(record => record.productId === productId))
  visit(catalog.securityNotices ?? [])
  for (const source of catalog.sources) if (source.productId === productId) ids.add(source.id)
  for (const route of catalog.securityFeedRoutes ?? []) if (route.productIds.includes(productId)) ids.add(route.articleId)
  return [...ids].sort()
}

export function productPartition(catalog, productId) {
  return {
    product: catalog.products.find(product => product.id === productId),
    ...Object.fromEntries(PRODUCT_COLLECTIONS.map(key => [key, (catalog[key] ?? []).filter(record => record.productId === productId)])),
    securityNotices: catalog.securityNotices ?? [],
    securityFeedRoutes: (catalog.securityFeedRoutes ?? []).filter(route => route.productIds.includes(productId)),
    securityFeedPageStates: (catalog.securityFeedPageStates ?? []).filter(state => sourceIdsForProduct(catalog, productId).includes(state.articleId)),
    ...(productId === 'vspc' ? Object.fromEntries(['vspcKbArticleIds', 'vspcKbCvePageStates', 'vspcCveRecordStates'].map(key => [key, catalog[key]])) : {}),
  }
}

export function transactionClosure(edges = []) {
  let groups = BASE_TRANSACTIONS.map(group => [...group])
  for (const edge of edges) {
    invariant(edge.length && edge.every(id => PRODUCT_IDS.includes(id)), 'UNKNOWN_SOURCE_OWNERSHIP')
    const joined = groups.filter(group => group.some(id => edge.includes(id)))
    groups = [...groups.filter(group => !joined.includes(group)), sorted(joined.flat())]
  }
  return groups.sort((a, b) => a[0].localeCompare(b[0]))
}

export function validateProductHealth(catalog, now = Date.now()) {
  invariant(catalog.schemaVersion === 2, 'Expected catalog schema 2')
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300_000
  invariant(timestamp(catalog.assembledAt) && timestamp(catalog.generatedAt), 'Invalid catalog timestamp')
  invariant(Array.isArray(catalog.productValidation) && catalog.productValidation.length === PRODUCT_IDS.length, 'Incomplete product validation metadata')
  invariant(same(sorted(catalog.productValidation.map(item => item.productId)), [...PRODUCT_IDS].sort()), 'Unknown or duplicate product validation')
  for (const item of catalog.productValidation) {
    invariant(['validated', 'retained'].includes(item.state), 'Invalid product validation state')
    invariant(timestamp(item.validatedAt) && timestamp(item.attemptedAt), 'Invalid product validation timestamp')
    invariant(Date.parse(item.validatedAt) <= Date.parse(item.attemptedAt) && Date.parse(item.attemptedAt) <= Date.parse(catalog.assembledAt), 'Inconsistent product timestamps')
    invariant(/^[a-f0-9]{64}$/.test(item.partitionHash ?? '') && /^[a-f0-9]{64}$/.test(item.transactionId ?? ''), 'Invalid product validation hash')
    invariant(Array.isArray(item.evidenceIds) && item.evidenceIds.length > 0 && item.evidenceIds.every(id => typeof id === 'string'), 'Missing product evidence')
    invariant(Array.isArray(item.failureCodes) && item.failureCodes.every(code => typeof code === 'string' && code.length > 0 && code.length <= 180), 'Invalid product failure codes')
    invariant(item.state === 'retained' ? item.failureCodes.length > 0 : item.failureCodes.length === 0, 'Inconsistent product failure state')
    if (item.state === 'validated') invariant(item.validatedAt === item.attemptedAt, 'Successful validation time differs from attempt')
  }
  invariant(Date.parse(catalog.generatedAt) === Math.min(...catalog.productValidation.map(item => Date.parse(item.validatedAt))), 'Global freshness must use oldest product validation')
  return true
}

export function validateCatalogProvenance(catalog, now = Date.now()) {
  validateProductHealth(catalog, now)
  invariant(/^[a-f0-9]{64}$/.test(catalog.refreshPolicyHash ?? ''), 'Missing refresh policy identity')
  invariant(Array.isArray(catalog.sourceRevisions) && Array.isArray(catalog.sourceObservations), 'Missing source provenance')
  const revisions = new Map(catalog.sourceRevisions.map(item => [item.id, item]))
  invariant(revisions.size === catalog.sourceRevisions.length, 'Duplicate source revision')
  for (const revision of revisions.values()) {
    invariant(['fetched', 'curated'].includes(revision.kind) && typeof revision.sourceId === 'string' && revision.sourceId.length > 0, 'Invalid source revision')
    invariant(/^[a-f0-9]{64}$/.test(revision.digest ?? '') && /^[a-f0-9]{64}$/.test(revision.policyHash ?? ''), 'Invalid source revision digest')
    invariant(revision.id === hash([revision.sourceId, revision.digest, revision.policyHash, revision.kind]), 'Source revision identity mismatch')
    invariant(Array.isArray(revision.validatedConsumers) && revision.validatedConsumers.length > 0 && revision.validatedConsumers.every(id => PRODUCT_IDS.includes(id)), 'Invalid source revision consumers')
  }
  for (const observation of catalog.sourceObservations) {
    invariant(typeof observation.sourceId === 'string' && /^https:\/\//.test(observation.url ?? '') && Number.isFinite(Date.parse(observation.fetchedAt)) && Date.parse(observation.fetchedAt) <= now + 300_000, 'Invalid source observation')
    invariant(observation.status === 'failed' ? typeof observation.failureCode === 'string' : observation.status === 'fetched' && /^[a-f0-9]{64}$/.test(observation.digest ?? ''), 'Invalid observation outcome')
  }
  for (const item of catalog.productValidation) {
    invariant(new Set(item.evidenceIds).size === item.evidenceIds.length, 'Duplicate product evidence')
    for (const id of item.evidenceIds) invariant(revisions.get(id)?.validatedConsumers.includes(item.productId), 'Unresolved product evidence')
    for (const sourceId of sourceIdsForProduct(catalog, item.productId)) invariant(item.evidenceIds.some(id => revisions.get(id).sourceId === sourceId), 'Missing accepted source: ' + sourceId)
    invariant(item.partitionHash === hash({ partition: productPartition(catalog, item.productId), evidenceIds: item.evidenceIds }), 'Product partition hash mismatch: ' + item.productId)
  }
  for (const revision of revisions.values()) for (const productId of revision.validatedConsumers) {
    invariant(catalog.productValidation.find(item => item.productId === productId).evidenceIds.includes(revision.id), 'Unused source revision consumer')
  }
  return true
}

// Cache successful and failed responses. Every validator sees exactly the same
// bytes; creating a new Response also prevents PDF parsers detaching shared data.
export function createObservationCollector(fetcher, now = () => new Date().toISOString()) {
  const cache = new Map(), observations = new Map(), usage = new Map()
  function forProducts(productIds) {
    return { async request(url, options = {}) {
      const key = String(url)
      usage.set(key, new Set([...(usage.get(key) ?? []), ...productIds]))
      if (!cache.has(key)) cache.set(key, (async () => {
        try {
          const response = await fetcher.request(url, options)
          const bytes = new Uint8Array(await response.arrayBuffer())
          const headers = Object.fromEntries(['content-type', 'etag', 'last-modified'].flatMap(name => response.headers.get(name) ? [[name, response.headers.get(name)]] : []))
          observations.set(key, { sourceId: options.sourceId ?? key, url: key, fetchedAt: now(), status: 'fetched', digest: hash(bytes), responseStatus: response.status, headers })
          return { bytes, headers, status: response.status }
        } catch (error) {
          observations.set(key, { sourceId: options.sourceId ?? key, url: key, fetchedAt: now(), status: 'failed', failureCode: 'SOURCE_FETCH_FAILED' })
          throw error
        }
      })())
      const result = await cache.get(key)
      return new Response(result.bytes.slice(), { status: result.status, headers: result.headers })
    } }
  }
  return { forProducts, observations, usage }
}

export function assembleCatalog({ current, baselines, outcomes, observations, usage, policyHash, assembledAt }) {
  const successes = outcomes.filter(outcome => outcome.result)
  invariant(successes.length > 0, 'ALL_TRANSACTIONS_BLOCKED')
  invariant(current.schemaVersion === 2 || successes.length === outcomes.length, 'SCHEMA_MIGRATION_REQUIRES_COMPLETE_REFRESH')
  invariant(same(sorted(outcomes.flatMap(outcome => outcome.productIds)), [...PRODUCT_IDS].sort()) && outcomes.flatMap(outcome => outcome.productIds).length === PRODUCT_IDS.length, 'Incomplete transaction outcomes')
  const catalog = structuredClone(current)
  const nextBaselines = structuredClone(baselines)
  const ownerByProduct = new Map(outcomes.flatMap(outcome => outcome.productIds.map(id => [id, outcome])))
  for (const key of PRODUCT_COLLECTIONS) {
    // Preserve the atomic adapter's ordering while replacing whole partitions.
    catalog[key] = PRODUCT_IDS.flatMap(id => (ownerByProduct.get(id).result?.catalog ?? current)[key].filter(record => record.productId === id))
  }
  catalog.products = PRODUCT_IDS.map(id => (ownerByProduct.get(id).result?.catalog ?? current).products.find(product => product.id === id))
  // Global inventory/classification was checked before any transaction.
  catalog.securityFeedArticleIds = successes[0].result.catalog.securityFeedArticleIds
  catalog.securityFeedRoutes = successes[0].result.catalog.securityFeedRoutes
  catalog.securityNotices = successes[0].result.catalog.securityNotices
  const pageStates = new Map(current.securityFeedPageStates.map(state => [state.articleId, state]))
  const acceptedSources = new Map(current.sources.map(source => [source.id, source]))
  for (const outcome of successes) {
    const candidate = outcome.result.catalog
    const relevant = new Set(outcome.productIds.flatMap(id => sourceIdsForProduct(candidate, id)))
    for (const route of candidate.securityFeedRoutes) if (!route.productIds.length) relevant.add(route.articleId)
    for (const state of candidate.securityFeedPageStates) if (relevant.has(state.articleId)) {
      pageStates.set(state.articleId, state)
      if (outcome.result.baselines.articles[state.articleId]) nextBaselines.articles[state.articleId] = outcome.result.baselines.articles[state.articleId]
    }
    for (const source of candidate.sources) if (relevant.has(source.id)) acceptedSources.set(source.id, source)
    if (outcome.productIds.includes('vspc')) for (const key of ['vspcKbArticleIds', 'vspcKbCvePageStates', 'vspcCveRecordStates']) catalog[key] = candidate[key]
  }
  catalog.securityFeedPageStates = [...pageStates.values()].sort((a, b) => a.articleId.localeCompare(b.articleId))
  catalog.sources = [...acceptedSources.values()]
  catalog.schemaVersion = 2
  catalog.assembledAt = assembledAt
  catalog.refreshPolicyHash = policyHash
  catalog.sourceObservations = [...observations.values()].sort((a,b) => a.url.localeCompare(b.url))
  const revisions = new Map()
  const addRevision = (revision, productId) => {
    const next = revisions.get(revision.id) ?? { ...revision, validatedConsumers: [] }
    next.validatedConsumers = sorted([...next.validatedConsumers, productId])
    revisions.set(next.id, next)
    return next.id
  }
  catalog.productValidation = PRODUCT_IDS.map(productId => {
    const outcome = ownerByProduct.get(productId)
    const prior = current.productValidation?.find(item => item.productId === productId)
    if (!outcome.result) {
      for (const id of prior.evidenceIds) addRevision(current.sourceRevisions.find(item => item.id === id), productId)
      return { ...prior, attemptedAt: assembledAt, state: 'retained', failureCodes: outcome.failureCodes }
    }
    const evidenceIds = []
    const required = sourceIdsForProduct(catalog, productId)
    const evidence = required.map(sourceId => {
      const source = catalog.sources.find(item => item.id === sourceId) ?? (catalog.securityFeedPageStates.some(item => item.articleId === sourceId) ? { id: sourceId, url: 'https://www.veeam.com/' + sourceId, acceptedFingerprint: nextBaselines.articles[sourceId]?.contentFingerprint } : undefined)
      invariant(source, 'Unknown catalog source ' + sourceId)
      const observed = observations.get(source.url)
      const { checkedAt, ...definition } = source
      return observed?.status === 'fetched' && usage.get(source.url)?.has(productId)
        ? { sourceId, digest: observed.digest, kind: 'fetched' }
        : { sourceId, digest: hash(definition), kind: 'curated' }
    })
    // Include pagination, discovery and official CVE-record responses even when
    // they are not presented as citation links in the product UI.
    for (const [url, observation] of observations) if (usage.get(url)?.has(productId) && observation.status === 'fetched' && !required.includes(observation.sourceId)) {
      evidence.push({ sourceId: observation.sourceId, digest: observation.digest, kind: 'fetched' })
    }
    for (const entry of evidence) {
      const revision = { ...entry, policyHash, id: hash([entry.sourceId, entry.digest, policyHash, entry.kind]) }
      evidenceIds.push(addRevision(revision, productId))
    }
    return { productId, transactionId: hash({ productIds: [...outcome.productIds].sort(), assembledAt, policyHash }), validatedAt: assembledAt, attemptedAt: assembledAt, state: 'validated', evidenceIds: sorted(evidenceIds), failureCodes: [], partitionHash: '' }
  })
  catalog.sourceRevisions = [...revisions.values()].sort((a,b) => a.id.localeCompare(b.id))
  catalog.generatedAt = catalog.productValidation.map(item => item.validatedAt).sort()[0]
  for (const item of catalog.productValidation) {
    if (item.state === 'validated') item.partitionHash = hash({ partition: productPartition(catalog, item.productId), evidenceIds: item.evidenceIds })
    else invariant(same(productPartition(catalog, item.productId), productPartition(current, item.productId)), 'Retained partition changed: ' + item.productId)
  }
  // A shared citation cannot claim a newer check than its oldest consumer.
  catalog.sources = catalog.sources.map(source => {
    const consumers = catalog.productValidation.filter(item => sourceIdsForProduct(catalog, item.productId).includes(source.id))
    const oldest = consumers.map(item => item.validatedAt).sort()[0]
    return oldest && Date.parse(source.checkedAt) > Date.parse(oldest) ? { ...source, checkedAt: oldest } : source
  })
  validateCatalogProvenance(catalog)
  return { catalog, baselines: nextBaselines }
}

