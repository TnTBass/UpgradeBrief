const productIds = {
  'Veeam Backup & Replication': 'vbr',
  'Veeam ONE': 'veeam-one',
  'Veeam Recovery Orchestrator': 'vro',
  'Veeam Service Provider Console': 'vspc',
}

function text(value) {
  return value.replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}

function monthEnd(value) {
  const date = new Date(`${value} 1, 00:00:00 UTC`)
  if (Number.isNaN(date.valueOf())) return undefined
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999))
}

function releaseMajor(release) {
  const value = release.aliases.find((alias) => /^\d+/.test(alias)) ?? release.name
  return Number(value.match(/^\d+/)?.[0])
}

function stateFor(policy, asOf) {
  if (monthEnd(policy.endOfSupport) < asOf) return 'end-of-support'
  if (monthEnd(policy.endOfFix) < asOf) return 'end-of-fix'
  return 'supported'
}

function summary(productName, policy, state, reference = false) {
  const context = reference ? `Veeam does not list ${productName} separately; this uses the corresponding Veeam Backup & Replication ${policy.version} lifecycle row as a reference. ` : ''
  if (state === 'end-of-support') return `${context}${productName} ${policy.version} reached end of support and security fixes in ${policy.endOfSupport}.`
  if (state === 'end-of-fix') return `${context}${productName} ${policy.version} reached end of fix in ${policy.endOfFix}; support and security fixes are listed through ${policy.endOfSupport}.`
  return `${context}${productName} ${policy.version} is listed with support and security fixes through ${policy.endOfSupport}.`
}

export function parseLifecyclePolicies(html) {
  let activeProductId
  const policies = []
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => text(cell[1]))
    if (cells.length < 5) continue
    if (productIds[cells[0]]) activeProductId = productIds[cells[0]]
    if (!activeProductId) continue
    const [maybeProduct, version, , endOfFix, endOfSupport] = cells
    if (!/^\d+/.test(version)) continue
    policies.push({ productId: activeProductId, version, major: Number(version.match(/^\d+/)[0]), endOfFix, endOfSupport })
  }
  return policies
}

export function mergeLifecyclePolicies(catalog, policies, asOf = new Date()) {
  const next = structuredClone(catalog)
  const retained = next.lifecycleNotices.filter((notice) => !notice.sourceIds.includes('lifecycle'))
  const notices = []

  for (const product of next.products) {
    const reference = product.id === 'enterprise-manager'
    const productPolicies = policies.filter((policy) => policy.productId === (reference ? 'vbr' : product.id))
    if (!productPolicies.length) continue
    const earliest = productPolicies.reduce((oldest, policy) => policy.major < oldest.major ? policy : oldest)
    for (const release of next.releases.filter((item) => item.productId === product.id)) {
      const major = releaseMajor(release)
      if (!Number.isFinite(major)) continue
      const policy = productPolicies.find((item) => item.major === major)
      if (policy) {
        const state = stateFor(policy, asOf)
        notices.push({ productId: product.id, releaseId: release.id, state, summary: summary(product.name, policy, state, reference), sourceIds: ['lifecycle'] })
      } else if (major < earliest.major) {
        notices.push({
          productId: product.id,
          releaseId: release.id,
          state: 'end-of-support',
          summary: `${reference ? `Veeam does not list ${product.name} separately; the corresponding Veeam Backup & Replication policy is used as a reference. ` : ''}${product.name} ${release.name} predates the earliest version (${earliest.version}) in Veeam's current public lifecycle table, whose support and security fixes ended in ${earliest.endOfSupport}. Treat this release as outside the published support window.`,
          sourceIds: ['lifecycle'],
        })
      }
    }
  }

  next.lifecycleNotices = [...retained, ...notices]
  return { catalog: next, notices: notices.length }
}
