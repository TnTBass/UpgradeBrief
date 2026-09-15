function decodeHtml(value) {
  return value.replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function parseVbrReleaseInformation(html) {
  return [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)]
    .map((match) => decodeHtml(match[1]))
    .filter((heading) => /^\d+(?:\.\d+){3}$/.test(heading))
    .filter((build, index, builds) => builds.indexOf(build) === index)
}

function versionFamily(value) {
  return value.match(/^(\d+\.\d+)\./)?.[1]
}

export function mergeVbrReleaseInformation(catalog, builds, sourceId, { applianceUpdateHowToSourceId, updateHowToSourceId } = {}) {
  const next = structuredClone(catalog)
  let attachments = 0
  for (const release of next.releases) {
    if (release.productId !== 'vbr' || !builds.some((build) => release.aliases.includes(build)) || release.sourceIds.includes(sourceId)) continue
    release.sourceIds.push(sourceId)
    attachments += 1
  }

  let paths = 0
  if (updateHowToSourceId || applianceUpdateHowToSourceId) {
    const product = next.products.find((item) => item.id === 'vbr')
    const target = product && next.releases.find((release) => release.id === product.recommendedReleaseId)
    const targetBuild = target && builds.find((build) => target.aliases.includes(build))
    const targetFamily = targetBuild && versionFamily(targetBuild)

    if (target && targetFamily) {
      const generatedPaths = []
      const targetIndex = builds.indexOf(targetBuild)

      if (updateHowToSourceId) {
        const generatedPath = (path) => path.productId === 'vbr'
          && path.sourceIds.includes(sourceId)
          && path.howToSourceIds?.includes(updateHowToSourceId)
        next.upgradePaths = next.upgradePaths.filter((path) => !generatedPath(path))
        for (const release of next.releases) {
          if (release.productId !== 'vbr' || release.id === target.id || next.upgradePaths.some((path) => path.fromReleaseId === release.id)) continue
          const releaseBuild = builds.find((build) => release.aliases.includes(build))
          if (!releaseBuild || builds.indexOf(releaseBuild) <= targetIndex || versionFamily(releaseBuild) !== targetFamily) continue
          generatedPaths.push({
            id: `${release.id}-to-${target.id}`,
            productId: 'vbr',
            fromReleaseId: release.id,
            toReleaseId: target.id,
            hopReleaseIds: [target.id],
            notes: ['Veeam documents this as a same-family update. On Windows-based backup servers running 13.1 or later, use Veeam Updater after reviewing prerequisites.'],
            howToSourceIds: [updateHowToSourceId],
            sourceIds: [sourceId, updateHowToSourceId],
          })
          paths += 1
        }
      }

      if (applianceUpdateHowToSourceId) {
        for (const release of next.releases.filter((item) => item.productId === 'vbr' && /Veeam Software Appliance/i.test(item.name))) {
          const existingPath = next.upgradePaths.find((path) => path.fromReleaseId === release.id)
          next.upgradePaths = next.upgradePaths.filter((path) => path.fromReleaseId !== release.id)
          generatedPaths.push({
            id: `${existingPath?.id.replace(/-to-.+$/, '') ?? release.id}-to-${target.id}`,
            productId: 'vbr',
            fromReleaseId: release.id,
            toReleaseId: target.id,
            hopReleaseIds: [target.id],
            notes: ['Veeam documents that Veeam Software Appliance updates, including major and minor releases, are installed through Veeam Updater within the appliance.'],
            howToSourceIds: [applianceUpdateHowToSourceId],
            sourceIds: [sourceId, applianceUpdateHowToSourceId],
          })
          paths += 1
        }
      }
      const insertAt = next.upgradePaths.findLastIndex((path) => path.productId === 'vbr') + 1
      next.upgradePaths.splice(insertAt, 0, ...generatedPaths)
    }
  }

  return { catalog: next, attachments, paths }
}
