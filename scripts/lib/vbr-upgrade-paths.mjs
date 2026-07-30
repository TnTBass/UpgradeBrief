function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/&rarr;|→/gi, '→')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function prefixForRoute(label, path) {
  const detailedVersion = path.match(/\((\d+(?:\.\d+){1,3})\.x\)/i)?.[1]
  if (detailedVersion) return `${detailedVersion}.`
  if (/^\d+(?:\.\d+){1,2}$/.test(label)) return `${label}.`
  return undefined
}

export function parseVbrUpgradePaths(html) {
  return [...html.matchAll(/<h3\b[^>]*>(.*?)<\/h3>([\s\S]*?)(?=<h3\b|$)/gi)]
    .flatMap((section) => {
      const heading = decodeHtml(section[1])
      const label = heading.match(/^((?:10a|11a)|\d+(?:\.\d+){0,2})\s+to\s+\d+(?:\.\d+){1,2}$/i)?.[1]
      const path = section[2].match(/<h5\b[^>]*>\s*Path:\s*(.*?)<\/h5>/i)?.[1]
      if (!label || !path) return []
      const normalizedPath = decodeHtml(path)
      const fromPrefix = prefixForRoute(label, normalizedPath)
      const families = [...new Set([...normalizedPath.matchAll(/\b(\d+\.\d+(?:\.\d+)?)\b/g)].map((match) => match[1]))]
      return fromPrefix && families.length >= 2 ? [{ label: label.toLowerCase(), fromPrefix, families, path: normalizedPath }] : []
    })
}

function releaseForFamily(catalog, family, prefix = `${family}.`) {
  return catalog.releases.find((release) => release.productId === 'vbr' && release.aliases.includes(family))
    ?? catalog.releases.find((release) => release.productId === 'vbr' && release.aliases.some((alias) => alias.startsWith(prefix)))
}

export function mergeVbrUpgradePaths(catalog, routes) {
  const next = structuredClone(catalog)
  const product = next.products.find((item) => item.id === 'vbr')
  const target = product && next.releases.find((release) => release.id === product.recommendedReleaseId)
  if (!target) throw new Error('VBR recommended release is missing from the build catalog.')
  const targetFamily = target.aliases.find((alias) => /^\d+\.\d+$/.test(alias))

  const retained = next.upgradePaths
    .filter((path) => path.productId !== 'vbr' || !path.sourceIds.includes('kb2053') || !Array.isArray(path.fromVersionPrefixes))
    .map((path) => {
      if (path.productId !== 'vbr' || !path.sourceIds.includes('kb2053') || Array.isArray(path.fromVersionPrefixes)) return path
      const installed = next.releases.find((release) => release.id === path.fromReleaseId)
      const documentedRoute = installed && routes.find((route) => route.families.at(-1) === targetFamily && installed.aliases.some((alias) => alias.startsWith(route.fromPrefix)))
      if (!documentedRoute) return path
      const intermediateHops = path.hopReleaseIds.filter((releaseId) => releaseId !== path.toReleaseId)
      return {
        ...path,
        id: `${path.id.replace(/-to-.+$/, '')}-to-${target.id}`,
        toReleaseId: target.id,
        hopReleaseIds: [...new Set([...intermediateHops, target.id])],
      }
    })
  const paths = routes.flatMap((route) => {
    const fromRelease = releaseForFamily(next, route.families[0], route.fromPrefix)
    const sourceTargetFamily = route.families.at(-1)
    if (!fromRelease || !targetFamily || sourceTargetFamily !== targetFamily) return []
    const hopReleaseIds = route.families.slice(1)
      .map((family) => releaseForFamily(next, family)?.id)
      .filter(Boolean)
    if (hopReleaseIds.at(-1) !== target.id) hopReleaseIds.push(target.id)
    return [{
      id: `vbr-${route.label.replace(/\./g, '-')}-to-${target.id}`,
      productId: 'vbr',
      fromReleaseId: fromRelease.id,
      fromVersionPrefixes: [route.fromPrefix],
      toReleaseId: target.id,
      hopReleaseIds: [...new Set(hopReleaseIds)],
      notes: ['Veeam documents this Windows upgrade route. Review prerequisites and use the upgrade wizard after confirming the supported source build.'],
      howToSourceIds: ['vbr-checklist'],
      sourceIds: ['kb2053', 'vbr-checklist'],
    }]
  })
  next.upgradePaths = [...retained, ...paths]
  return { catalog: next, paths: paths.length }
}
