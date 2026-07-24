function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/&rarr;|→/gi, '→')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function routePrefix(heading, path) {
  const match = `${heading} ${path}`.match(/\b(\d+(?:\.\d+)?)\.x\b/)
  if (match) return `${match[1]}.`
  if (/^7a\b/i.test(heading)) return '7.1.'
  if (/^7\b/.test(heading)) return '7.0.'
  return undefined
}

export function parseVb365UpgradePaths(html) {
  return [...html.matchAll(/<h3\b[^>]*>(.*?)<\/h3>[\s\S]{0,1200}?<h5\b[^>]*>\s*Path:\s*(.*?)<\/h5>/gi)]
    .map((match) => ({ heading: decodeHtml(match[1]), path: decodeHtml(match[2]) }))
    .map((route) => ({ ...route, prefix: routePrefix(route.heading, route.path) }))
    .filter((route) => route.prefix && /→/.test(route.path))
}

function releaseForPrefix(catalog, prefix) {
  return catalog.releases.find((release) => release.productId === 'vb365' && release.aliases.some((alias) => alias.startsWith(prefix)))
}

function releaseForFamily(catalog, family) {
  const prefix = `${family}.`
  return catalog.releases.find((release) => release.productId === 'vb365' && release.aliases.some((alias) => alias.startsWith(prefix)))
}

export function mergeVb365UpgradePaths(catalog, routes) {
  const next = structuredClone(catalog)
  const product = next.products.find((item) => item.id === 'vb365')
  const target = product && next.releases.find((release) => release.id === product.recommendedReleaseId)
  if (!target) throw new Error('VB365 recommended release is missing from the build catalog.')
  const targetFamily = target.aliases.find((alias) => /^\d+\.\d+$/.test(alias))

  const retained = next.upgradePaths.filter((path) => path.productId !== 'vb365')
  const paths = routes.flatMap((route) => {
    const fromRelease = releaseForPrefix(next, route.prefix)
    if (!fromRelease) return []
    const families = [...new Set([...route.path.matchAll(/\b(\d+\.\d+)\b/g)].map((match) => match[1]))]
    const sourceTargetFamily = families.at(-1)
    if (!targetFamily || sourceTargetFamily !== targetFamily) return []
    const intermediateFamilies = families.slice(1, -1)
    const hopReleaseIds = intermediateFamilies
      .map((family) => releaseForFamily(next, family)?.id)
      .filter(Boolean)
    hopReleaseIds.push(target.id)
    return [{
      id: `vb365-${route.prefix.replace(/\.$/, '').replace('.', '-')}-to-${target.id}`,
      productId: 'vb365',
      fromReleaseId: fromRelease.id,
      fromVersionPrefixes: [route.prefix],
      toReleaseId: target.id,
      hopReleaseIds: [...new Set(hopReleaseIds)],
      notes: ['Veeam documents this route. Plan for stopped backup jobs and review repositories, proxies, proxy pools, and Veeam Explorers after the upgrade.'],
      howToSourceIds: ['vb365-upgrade', 'vb365-after-upgrade'],
      sourceIds: ['kb4098'],
    }]
  })
  next.upgradePaths = [...retained, ...paths]
  return { catalog: next, paths: paths.length }
}
