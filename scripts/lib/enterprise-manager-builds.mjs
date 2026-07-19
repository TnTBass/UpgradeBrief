function exactBuild(release) {
  return release.aliases.find((alias) => /^\d+(?:\.\d+){3}$/.test(alias))
}

function compareBuild(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 4; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

function isSupportedModernBuild(build) {
  return compareBuild(build, '12.3.1.1139') >= 0
}

function idForBuild(build) {
  return `em-build-${build.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '')}`
}

function displayName(release, build) {
  const label = release.name.replace(/\s*\(build[^)]*\)\s*$/i, '').replace(/^13 Veeam Software Appliance$/i, '13.0.0')
  return `${label} (build ${build})`
}

export function mergeEnterpriseManagerBuilds(catalog) {
  const next = structuredClone(catalog)
  let additions = 0

  for (const vbrRelease of next.releases.filter((release) => release.productId === 'vbr')) {
    const build = exactBuild(vbrRelease)
    if (!build || !isSupportedModernBuild(build)) continue

    const existing = next.releases.find((release) => release.productId === 'enterprise-manager' && release.aliases.includes(build))
    const sourceIds = [...new Set([...vbrRelease.sourceIds, 'em-upgrade'])]
    if (existing) {
      for (const sourceId of sourceIds) if (!existing.sourceIds.includes(sourceId)) existing.sourceIds.push(sourceId)
      continue
    }

    const label = displayName(vbrRelease, build).replace(/\s*\(build[^)]*\)\s*$/i, '')
    next.releases.push({
      id: idForBuild(build),
      productId: 'enterprise-manager',
      name: displayName(vbrRelease, build),
      aliases: [build, label],
      sourceIds,
    })
    additions += 1
  }

  const enterpriseManager = next.products.find((product) => product.id === 'enterprise-manager')
  const latest = next.releases
    .filter((release) => release.productId === 'enterprise-manager')
    .map((release) => ({ release, build: exactBuild(release) }))
    .filter((candidate) => candidate.build)
    .sort((left, right) => compareBuild(right.build, left.build))[0]
  if (enterpriseManager && latest) enterpriseManager.recommendedReleaseId = latest.release.id

  return { catalog: next, additions }
}
