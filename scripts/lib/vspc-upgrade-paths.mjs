function plainText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function parseVspcUpgradePaths(html) {
  const text = plainText(html)
  const supported = text.match(/You can upgrade product components if you run Veeam Service Provider Console version (\d+\.\d+) or (\d+\.\d+) \(build #(\d+(?:\.\d+){3}) or later\)\./)
  const targetBuild = text.match(/Page content applies to build (\d+(?:\.\d+){3})\b/)?.[1]
  if (!supported || !targetBuild || !supported[3].startsWith(`${supported[2]}.`)) {
    throw new Error('VSPC upgrade guide did not yield supported source families, a minimum build, and a target build; refusing to replace routes.')
  }
  return {
    targetFamily: targetBuild.split('.').slice(0, 2).join('.'),
    sourceFamilies: [supported[1], supported[2]],
    minimumBuild: supported[3],
    minimumBuildFamily: supported[2],
  }
}

function inFamily(release, family) {
  return release.productId === 'vspc' && release.aliases.some((alias) => alias === family || alias.startsWith(`${family}.`))
}

function compareBuild(left, right) {
  const rightParts = right.split('.').map(Number)
  for (const [index, part] of left.split('.').map(Number).entries()) {
    if (part !== rightParts[index]) return part - rightParts[index]
  }
  return 0
}

export function mergeVspcUpgradePaths(catalog, guidance) {
  const next = structuredClone(catalog)
  const targetId = next.products.find((product) => product.id === 'vspc')?.recommendedReleaseId
  const target = next.releases.find((release) => release.id === targetId)
  if (!target || !inFamily(target, guidance.targetFamily)) {
    throw new Error('VSPC recommended release is outside the documented upgrade target family; refusing to infer a route.')
  }
  const sourceReleases = next.releases.filter((release) => guidance.sourceFamilies.some((family) => inFamily(release, family)))
  const managedIds = new Set(sourceReleases.map((release) => release.id))
  const retained = next.upgradePaths.filter((path) => path.productId !== 'vspc' || !managedIds.has(path.fromReleaseId))
  const paths = sourceReleases.flatMap((release) => {
    if (inFamily(release, guidance.minimumBuildFamily)) {
      const builds = release.aliases.filter((alias) => /^\d+(?:\.\d+){3}$/.test(alias))
      if (!builds.length || builds.some((build) => compareBuild(build, guidance.minimumBuild) < 0)) return []
    }
    return [{
      id: `${release.id}-to-${target.id}`,
      productId: 'vspc',
      fromReleaseId: release.id,
      toReleaseId: target.id,
      hopReleaseIds: [target.id],
      notes: [
        `Veeam supports an in-place upgrade to ${guidance.targetFamily} from ${guidance.sourceFamilies.join(' or ')}; ${guidance.minimumBuildFamily} requires build ${guidance.minimumBuild} or later.`,
        'Use the deployment ISO for this upgrade. Review the prerequisites and upgrade the managed components as described in the deployment guide.',
      ],
      howToSourceIds: ['vspc-upgrade', 'kb4788'],
      sourceIds: ['vspc-upgrade', 'kb4788'],
    }]
  })
  if (!guidance.sourceFamilies.every((family) => paths.some((path) => inFamily(sourceReleases.find((release) => release.id === path.fromReleaseId), family)))) {
    throw new Error('VSPC upgrade merge is missing a supported source family; refusing to replace routes.')
  }
  // Exact build routes keep pre-GA 9.1 RTM builds below the documented minimum
  // from inheriting a broad 9.1 prefix. New builds receive routes during refresh.
  next.upgradePaths = [...retained, ...paths]
  return { catalog: next, paths: paths.length }
}
