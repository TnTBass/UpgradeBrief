function plainText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function parseVspcUpgradePaths(html) {
  const text = plainText(html)
  const supported = text.match(/You can upgrade product components if you run Veeam Service Provider Console version (\d+\.\d+) or (\d+\.\d+) \(build #(\d+(?:\.\d+){3}) or later\)\./)
  const targetBuild = text.match(/Page content applies to build (\d+(?:\.\d+){3})\b/)?.[1]
  const intermediate = text.match(/If you run Veeam Service Provider Console version (\d+(?:\.\d+)?), you must first perform an upgrade of all Veeam Service Provider Console components to version (\d+\.\d+):/)
  if (!supported || !targetBuild || !supported[3].startsWith(`${supported[2]}.`)) {
    throw new Error('VSPC upgrade guide did not yield supported source families, a minimum build, and a target build; refusing to replace routes.')
  }
  if (!intermediate || intermediate[2] !== supported[2]) {
    throw new Error('VSPC upgrade guide did not yield the required intermediate upgrade; refusing to replace routes.')
  }
  return {
    targetFamily: targetBuild.split('.').slice(0, 2).join('.'),
    sourceFamilies: [supported[1], supported[2]],
    minimumBuild: supported[3],
    minimumBuildFamily: supported[2],
    intermediate: {
      fromFamily: intermediate[1].includes('.') ? intermediate[1] : `${intermediate[1]}.0`,
      viaFamily: intermediate[2],
      supportRequired: text.includes(`To upgrade to version ${intermediate[2]}, contact Veeam Customer Support`),
    },
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
  const managedFamilies = [...guidance.sourceFamilies, guidance.intermediate.fromFamily]
  const sourceReleases = next.releases.filter((release) => managedFamilies.some((family) => inFamily(release, family)))
  const managedIds = new Set(sourceReleases.map((release) => release.id))
  const retained = next.upgradePaths.filter((path) => path.productId !== 'vspc' || !managedIds.has(path.fromReleaseId))
  const paths = sourceReleases.flatMap((release) => {
    if (inFamily(release, guidance.intermediate.fromFamily)) return []
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
  const intermediateRelease = sourceReleases.find((release) =>
    inFamily(release, guidance.intermediate.viaFamily) && paths.some((path) => path.fromReleaseId === release.id))
  if (!intermediateRelease) throw new Error('VSPC upgrade merge is missing a supported intermediate release; refusing to replace routes.')
  for (const release of sourceReleases.filter((item) => inFamily(item, guidance.intermediate.fromFamily))) {
    paths.push({
      id: `${release.id}-to-${target.id}`,
      productId: 'vspc',
      fromReleaseId: release.id,
      toReleaseId: target.id,
      hopReleaseIds: [intermediateRelease.id, target.id],
      notes: [
        `Upgrade all Veeam Service Provider Console components, including management agents, to ${guidance.intermediate.viaFamily} build ${guidance.minimumBuild} or later before upgrading to ${guidance.targetFamily}.`,
        ...(guidance.intermediate.supportRequired ? [`Contact Veeam Customer Support to obtain version ${guidance.intermediate.viaFamily} for the intermediate upgrade.`] : []),
        'Use the deployment ISO for each upgrade and review the prerequisites for both versions.',
      ],
      howToSourceIds: ['vspc-upgrade-9.1', 'vspc-upgrade', 'kb4788'],
      sourceIds: ['vspc-upgrade-9.1', 'vspc-upgrade', 'kb4788'],
    })
  }
  // Exact build routes keep pre-GA 9.1 RTM builds below the documented minimum
  // from inheriting a broad 9.1 prefix. New builds receive routes during refresh.
  next.upgradePaths = [...retained, ...paths]
  return { catalog: next, paths: paths.length }
}
