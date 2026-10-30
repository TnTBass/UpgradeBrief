import { repairHash } from './catalog-repair-evidence.mjs'
import { validateProductHealth } from './catalog-provenance.mjs'

export function productCatalogFreshness(catalog, now = Date.now()) {
  if (typeof catalog === 'string') return catalogFreshness(catalog, now)
  if (catalog?.schemaVersion === 1) return catalogFreshness(catalog.generatedAt, now)
  try { validateProductHealth(catalog, now) }
  catch { return { level: 'critical', ageHours: null, reason: 'invalid-product-health' } }
  const products = catalog.productValidation.map(item => {
    const age = catalogFreshness(item.validatedAt, now)
    return { productId: item.productId, validatedAt: item.validatedAt, state: item.state, failureCodes: item.failureCodes, ...age,
      level: item.state === 'retained' && age.level === 'healthy' ? 'warning' : age.level,
      reason: item.state === 'retained' ? 'retained-product-data' : age.reason }
  })
  const rank = { healthy: 0, warning: 1, critical: 2 }
  const worst = [...products].sort((a,b) => rank[b.level] - rank[a.level] || b.ageHours - a.ageHours)[0]
  return { level: worst.level, ageHours: Math.max(...products.map(item => item.ageHours ?? Infinity)), reason: worst.reason, products }
}


export function catalogFreshness(generatedAt, now = Date.now()) {
  const timestamp = Date.parse(generatedAt)
  if (!Number.isFinite(timestamp) || timestamp > now + 300_000) return { level: 'critical', ageHours: null, reason: 'invalid-catalog-timestamp' }
  const ageHours = Math.max(0, (now - timestamp) / 3_600_000)
  return { level: ageHours >= 72 ? 'critical' : ageHours >= 36 ? 'warning' : 'healthy', ageHours, reason: 'catalog-age' }
}

export function combinedCatalogFreshness(generatedAt, published, now = Date.now(), expected = {}) {
  const repository = productCatalogFreshness(generatedAt, now)
  const validPublication = [1, 2].includes(published?.schemaVersion) && /^[a-f0-9]{40}$/.test(published.commit ?? '') && /^[a-f0-9]{64}$/.test(published.catalogHash ?? '')
    && (!expected.commit || published.commit === expected.commit) && (!expected.catalogHash || published.catalogHash === expected.catalogHash)
  const deployment = validPublication ? productCatalogFreshness(published, now) : { level: 'critical', ageHours: null, reason: 'published-health-unavailable' }
  const rank = { healthy: 0, warning: 1, critical: 2 }
  return { level: rank[repository.level] > rank[deployment.level] ? repository.level : deployment.level, repository, deployment }
}

export function workflowFailureIdentity(failed, diagnostic) {
  // Bind the diagnostic to the signature: different article failures at the
  // same workflow step must not collapse into one stale investigation.
  const detail = diagnostic?.schemaVersion === 1 && diagnostic.code === 'REPAIR_PREPARATION_FAILED'
    ? { code: diagnostic.code, articleId: /^kb\d+$/.test(diagnostic.articleId ?? '') ? diagnostic.articleId : null, message: String(diagnostic.message ?? '').slice(0, 1200) }
    : null
  return { id: repairHash({ kind: 'repair-workflow-failure', failed: [...failed].sort(), detail }), detail }
}

export function updateFailureOccurrence(body, { runId, url, detail, failed }) {
  const safe = value => String(value).replace(/[<>&@`]/g, char => `&#${char.charCodeAt(0)};`)
  const start = '<!-- latest-catalog-failure -->', end = '<!-- /latest-catalog-failure -->'
  const occurrence = `${start}\nLatest failed run: [${runId}](${url}).\n\nFailed steps: ${failed.map(safe).join(', ') || 'unknown'}.\n${detail ? `\nCause: ${safe(detail.message)}\n` : ''}${end}`
  const first = body.indexOf(start), last = body.indexOf(end, first)
  return first >= 0 && last >= first ? body.slice(0, first) + occurrence + body.slice(last + end.length) : body + '\n\n' + occurrence
}
