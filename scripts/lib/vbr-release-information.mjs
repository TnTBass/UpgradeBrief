function decodeHtml(value) {
  return value.replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function parseVbrReleaseInformation(html) {
  return [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)]
    .map((match) => decodeHtml(match[1]))
    .filter((heading) => /^\d+(?:\.\d+){3}$/.test(heading))
    .filter((build, index, builds) => builds.indexOf(build) === index)
}

export function mergeVbrReleaseInformation(catalog, builds, sourceId) {
  const next = structuredClone(catalog)
  let attachments = 0
  for (const release of next.releases) {
    if (release.productId !== 'vbr' || !builds.some((build) => release.aliases.includes(build)) || release.sourceIds.includes(sourceId)) continue
    release.sourceIds.push(sourceId)
    attachments += 1
  }
  return { catalog: next, attachments }
}
